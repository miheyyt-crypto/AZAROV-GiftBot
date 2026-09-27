import {
  inboundEvents,
  kickAccounts,
  kickOauthStates,
} from "@giftbot/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { randomBytes, createHash } from "node:crypto";
import type { GiftbotDb } from "./db.js";
import { ConflictError, NotFoundError } from "./errors.js";
import { normalizeHttpsAvatarUrl } from "./https-url.js";
import {
  applyKickChatMessageIn,
  endKickStreamSessionIn,
  isChatMessageEventType,
  isLivestreamEventType,
  parseChatMessagePayload,
  parseLivestreamPayload,
  startKickStreamSessionIn,
  KICK_TARGET_CHANNEL,
} from "./stream-xp.js";

export const KICK_OAUTH_STATE_TTL_SECONDS = 600;
export const KICK_OAUTH_SCOPE = "user:read";
export const KICK_AUTHORIZE_URL = "https://id.kick.com/oauth/authorize";

export type KickOAuthState = {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  expiresAt: Date;
};

export type KickAccountLinkInput = {
  userId: string;
  kickUserId: string;
  accessTokenEncrypted?: string;
  refreshTokenEncrypted?: string;
  scope?: string;
  tokenExpiresAt?: Date;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
};

export type KickLivestreamTransition =
  | "offline_to_live"
  | "live_to_live"
  | "live_to_offline"
  | "offline_to_offline"
  | "ignored";

export type KickApplyResult = {
  replayed: boolean;
  kickAccountId?: string;
  livestream?: {
    previous?: "offline" | "live";
    current?: "offline" | "live";
    transition: KickLivestreamTransition;
    sessionId?: string;
    providerStreamId?: string | null;
    broadcastRecipientCount?: number;
  };
};

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildKickAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope?: string;
}): string {
  const url = new URL(KICK_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", input.scope ?? KICK_OAUTH_SCOPE);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function createKickOAuthState(
  db: GiftbotDb,
  input: { userId: string; ttlSeconds?: number },
): Promise<KickOAuthState> {
  const pkce = createPkcePair();
  const state = randomBytes(32).toString("base64url");
  const ttlSeconds = input.ttlSeconds ?? KICK_OAUTH_STATE_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await db.insert(kickOauthStates).values({
    state,
    userId: input.userId,
    codeChallenge: pkce.challenge,
    codeVerifier: pkce.verifier,
    expiresAt,
  });
  return {
    state,
    codeVerifier: pkce.verifier,
    codeChallenge: pkce.challenge,
    expiresAt,
  };
}

export async function consumeKickOAuthState(
  db: GiftbotDb,
  state: string,
): Promise<{ userId: string; codeVerifier: string }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(kickOauthStates)
      .where(eq(kickOauthStates.state, state))
      .for("update");
    const row = rows[0];
    if (!row || row.consumedAt || row.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundError("kick oauth state is not usable");
    }
    if (!row.codeVerifier) {
      throw new NotFoundError("kick oauth state is not usable");
    }
    await tx
      .update(kickOauthStates)
      .set({ consumedAt: new Date() })
      .where(eq(kickOauthStates.id, row.id));
    return { userId: row.userId, codeVerifier: row.codeVerifier };
  });
}

export async function linkKickAccount(
  db: GiftbotDb,
  input: KickAccountLinkInput,
): Promise<{ id: string; created: boolean }> {
  return db.transaction(async (tx) => {
    const byKick = await tx
      .select()
      .from(kickAccounts)
      .where(eq(kickAccounts.kickUserId, input.kickUserId))
      .limit(1);
    const existingKick = byKick[0];
    if (existingKick && existingKick.userId !== input.userId) {
      throw new ConflictError("kick account is linked to another user");
    }

    const activeRows = await tx
      .select()
      .from(kickAccounts)
      .where(
        and(eq(kickAccounts.userId, input.userId), eq(kickAccounts.status, "active")),
      )
      .limit(1);
    const active = activeRows[0];

    const profileFields = kickProfilePatch(input);
    const tokenFields = {
      ...(input.accessTokenEncrypted !== undefined
        ? { accessTokenEncrypted: input.accessTokenEncrypted }
        : {}),
      ...(input.refreshTokenEncrypted !== undefined
        ? { refreshTokenEncrypted: input.refreshTokenEncrypted }
        : {}),
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      ...(input.tokenExpiresAt !== undefined
        ? { tokenExpiresAt: input.tokenExpiresAt }
        : {}),
      ...profileFields,
      status: "active" as const,
      lastRefreshedAt: new Date(),
    };

    if (existingKick) {
      if (active && active.id !== existingKick.id) {
        await tx
          .update(kickAccounts)
          .set({ status: "revoked" })
          .where(eq(kickAccounts.id, active.id));
      }
      await tx
        .update(kickAccounts)
        .set(tokenFields)
        .where(eq(kickAccounts.id, existingKick.id));
      return { id: existingKick.id, created: false };
    }

    if (active) {
      await tx
        .update(kickAccounts)
        .set({ status: "revoked" })
        .where(eq(kickAccounts.id, active.id));
    }

    const inserted = await tx
      .insert(kickAccounts)
      .values({
        userId: input.userId,
        kickUserId: input.kickUserId,
        ...tokenFields,
      })
      .returning({ id: kickAccounts.id });
    const created = inserted[0];
    if (!created) {
      throw new Error("failed to link kick account");
    }
    return { id: created.id, created: true };
  });
}

function kickProfilePatch(input: KickAccountLinkInput): {
  username?: string;
  displayName?: string;
  avatarUrl?: string;
} {
  const username = input.username?.trim();
  const displayName = input.displayName?.trim();
  const avatarUrl = normalizeHttpsAvatarUrl(input.avatarUrl);
  return {
    ...(username ? { username } : {}),
    ...(displayName ? { displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function pushId(target: string[], value: unknown): void {
  if (typeof value === "string" && value.length > 0) {
    target.push(value);
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    target.push(String(value));
  }
}

export function extractKickUserIds(payload: unknown): string[] {
  const ids: string[] = [];
  const root = asRecord(payload);
  if (!root) {
    return ids;
  }
  pushId(ids, root.kick_user_id);
  pushId(ids, root.user_id);
  pushId(ids, root.broadcaster_user_id);
  const user = asRecord(root.user);
  pushId(ids, user?.id);
  pushId(ids, user?.user_id);
  const sender = asRecord(root.sender);
  pushId(ids, sender?.user_id);
  pushId(ids, sender?.id);
  const subscriber = asRecord(root.subscriber);
  pushId(ids, subscriber?.user_id);
  const data = asRecord(root.data);
  pushId(ids, data?.user_id);
  pushId(ids, data?.broadcaster_user_id);
  const dataUser = asRecord(data?.user);
  pushId(ids, dataUser?.id);
  const dataSender = asRecord(data?.sender);
  pushId(ids, dataSender?.user_id);
  pushId(ids, dataSender?.id);
  return [...new Set(ids)];
}

export async function applyKickInboundEvent(
  db: GiftbotDb,
  inboundEventId: string,
): Promise<KickApplyResult> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(inboundEvents)
      .where(eq(inboundEvents.id, inboundEventId))
      .for("update");
    const inbound = rows[0];
    if (!inbound) {
      throw new NotFoundError("inbound event is missing");
    }
    if (inbound.processingStatus === "processed") {
      return { replayed: true };
    }

    const kickUserIds = extractKickUserIds(inbound.payload);
    let kickAccountId: string | undefined;
    let livestream: KickApplyResult["livestream"];
    if (kickUserIds.length > 0) {
      const matched = await tx
        .select()
        .from(kickAccounts)
        .where(inArray(kickAccounts.kickUserId, kickUserIds))
        .limit(1);
      const account = matched[0];
      if (account) {
        kickAccountId = account.id;
        await tx
          .update(kickAccounts)
          .set({ lastInboundEventId: inbound.id })
          .where(eq(kickAccounts.id, account.id));
      }
    }

    if (isLivestreamEventType(inbound.eventType)) {
      const parsed = parseLivestreamPayload(inbound.payload);
      if (!parsed || parsed.channel !== KICK_TARGET_CHANNEL) {
        livestream = { transition: "ignored" };
      } else if (parsed.isLive) {
        const started = await startKickStreamSessionIn(tx, {
          channel: parsed.channel,
          providerStreamId: parsed.providerStreamId,
        });
        livestream = {
          previous: started.created ? "offline" : "live",
          current: "live",
          transition: started.created ? "offline_to_live" : "live_to_live",
          sessionId: started.sessionId,
          providerStreamId: parsed.providerStreamId,
          broadcastRecipientCount: started.broadcastRecipientCount,
        };
      } else {
        const ended = await endKickStreamSessionIn(tx, {
          channel: parsed.channel,
          providerStreamId: parsed.providerStreamId,
        });
        livestream = {
          previous: ended.ended ? "live" : "offline",
          current: "offline",
          transition: ended.ended ? "live_to_offline" : "offline_to_offline",
          ...(ended.sessionId ? { sessionId: ended.sessionId } : {}),
          providerStreamId: parsed.providerStreamId,
          broadcastRecipientCount: 0,
        };
      }
    } else if (isChatMessageEventType(inbound.eventType)) {
      const parsed = parseChatMessagePayload(inbound.payload);
      if (parsed) {
        await applyKickChatMessageIn(tx, {
          providerMessageId: parsed.providerMessageId,
          kickUserId: parsed.kickUserId,
          channel: parsed.channel,
          inboundEventId: inbound.id,
        });
      }
    }

    await tx
      .update(inboundEvents)
      .set({
        processingStatus: "processed",
        processedAt: new Date(),
        lastError: null,
      })
      .where(eq(inboundEvents.id, inbound.id));

    return {
      replayed: false,
      ...(kickAccountId ? { kickAccountId } : {}),
      ...(livestream ? { livestream } : {}),
    };
  });
}
