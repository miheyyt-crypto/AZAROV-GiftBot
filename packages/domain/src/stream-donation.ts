import {
  jobs,
  streamAlertConsumers,
  streamDonations,
  telegramAccounts,
  users,
} from "@giftbot/db/schema";
import { and, asc, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import {
  STREAM_ALERT_HEARTBEAT_EXTEND_MS,
  STREAM_ALERT_PLAYING_MAX_MS,
  streamDonationPlayingHoldMs,
  type StreamDonationTtsStatus,
} from "./stream-donation-audio.js";

export type { StreamDonationTtsStatus } from "./stream-donation-audio.js";

export {
  STREAM_ALERT_COMPLETE_TIMEOUT_MS,
  STREAM_ALERT_DING_GAP_MS,
  STREAM_ALERT_HEARTBEAT_EXTEND_MS,
  STREAM_ALERT_PLAYING_MAX_MS,
  STREAM_ALERT_TTS_PLAY_MAX_MS,
  STREAM_ALERT_TTS_WAIT_MS,
  streamDonationPlayingHoldMs,
} from "./stream-donation-audio.js";
import type { Clock } from "./clock.js";
import { systemClock } from "./clock.js";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import {
  OverlayBusyError,
  StreamDonationInvalidMessageError,
  StreamDonationInvalidRequestError,
} from "./errors.js";
import { asBigInt } from "./money.js";

export const STREAM_DONATION_MESSAGE_MAX = 300;
export const STREAM_DONATION_VISIBLE_MS = 8_000;
export const STREAM_DONATION_PLAYING_LEASE_MS = 45_000;
export const STREAM_ALERT_TTS_JOB_TYPE = "stream_alert.synthesize_tts";
export const STREAM_ALERT_CONSUMER_LEASE_MS = 30_000;
export const STREAM_DONATION_ADMIN_LIMIT = 40;

const OVERLAY_SESSION_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type StreamDonationStatus = "queued" | "playing" | "finished";

export type StreamDonationView = {
  id: string;
  displayName: string;
  message: string;
  amountAzc: string;
  status: StreamDonationStatus;
  ttsStatus: StreamDonationTtsStatus;
  ttsDurationMs: number | null;
  createdAt: string;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  playingExpiresAt: string | null;
};

export type StreamDonationEnqueueResult = StreamDonationView & {
  replayed: boolean;
};

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let i = 0; i < 4; i += 1) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      (current as { code: unknown }).code === "23505"
    ) {
      return true;
    }
    if (typeof current !== "object" || current === null || !("cause" in current)) {
      return false;
    }
    current = (current as { cause: unknown }).cause;
  }
  return false;
}

export function parseOverlaySessionId(raw: string): string {
  const value = raw.trim();
  if (!OVERLAY_SESSION_RE.test(value)) {
    throw new StreamDonationInvalidRequestError();
  }
  return value;
}

export function parseStreamDonationId(raw: string): string {
  const value = raw.trim();
  if (!OVERLAY_SESSION_RE.test(value)) {
    throw new StreamDonationInvalidRequestError();
  }
  return value;
}

export function normalizeStreamDonationMessage(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new StreamDonationInvalidMessageError();
  }
  const message = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (message.length === 0 || message.length > STREAM_DONATION_MESSAGE_MAX) {
    throw new StreamDonationInvalidMessageError();
  }
  return message;
}

export function streamDonationDisplayName(input: {
  username: string | null;
  firstName: string | null;
  displayName: string | null;
  telegramUserId: bigint;
}): string {
  const username = input.username?.trim();
  if (username) {
    return username.startsWith("@") ? username : `@${username}`;
  }
  const first = input.firstName?.trim();
  if (first) {
    return first;
  }
  const display = input.displayName?.trim();
  if (display) {
    return display;
  }
  const tail = input.telegramUserId.toString().slice(-5);
  return `Игрок ${tail || "00000"}`;
}

function toView(
  row: typeof streamDonations.$inferSelect,
): StreamDonationView {
  return {
    id: row.id,
    displayName: row.displayName,
    message: row.message,
    amountAzc: asBigInt(row.amountAzc).toString(),
    status: row.status,
    ttsStatus: row.ttsStatus,
    ttsDurationMs: row.ttsDurationMs,
    createdAt: row.createdAt.toISOString(),
    queuedAt: row.queuedAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    playingExpiresAt: row.playingExpiresAt
      ? row.playingExpiresAt.toISOString()
      : null,
  };
}

async function loadIdentity(
  tx: GiftbotTx,
  userId: string,
): Promise<{
  telegramUserId: bigint;
  displayName: string;
}> {
  const userRows = await tx
    .select({
      displayName: users.displayName,
      publicId: users.publicId,
      status: users.status,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = userRows[0];
  if (!user || user.status !== "active") {
    throw new StreamDonationInvalidRequestError();
  }
  const accounts = await tx
    .select()
    .from(telegramAccounts)
    .where(
      and(
        eq(telegramAccounts.userId, userId),
        eq(telegramAccounts.isActive, true),
      ),
    )
    .limit(1);
  const account = accounts[0];
  const telegramUserId = account?.telegramUserId ?? 0n;
  return {
    telegramUserId,
    displayName: streamDonationDisplayName({
      username: account?.username ?? null,
      firstName: account?.firstName ?? null,
      displayName: user.displayName,
      telegramUserId: telegramUserId === 0n ? BigInt(`0x${user.publicId.replace(/-/g, "").slice(0, 12)}`) : telegramUserId,
    }),
  };
}

export async function enqueueStreamDonationIn(
  tx: GiftbotTx,
  input: {
    userId: string;
    purchaseId: string;
    walletTransactionId: string;
    message: unknown;
    amountAzc: bigint;
  },
): Promise<StreamDonationEnqueueResult> {
  const message = normalizeStreamDonationMessage(input.message);
  const purchaseId = parseStreamDonationId(input.purchaseId);
  if (input.amountAzc <= 0n) {
    throw new StreamDonationInvalidRequestError();
  }
  const existing = await tx
    .select()
    .from(streamDonations)
    .where(eq(streamDonations.shopPurchaseId, purchaseId))
    .limit(1);
  const prior = existing[0];
  if (prior) {
    return { ...toView(prior), replayed: true };
  }
  const identity = await loadIdentity(tx, input.userId);
  try {
    const inserted = await tx
      .insert(streamDonations)
      .values({
        userId: input.userId,
        telegramUserId: identity.telegramUserId,
        displayName: identity.displayName,
        message,
        amountAzc: input.amountAzc,
        status: "queued",
        clientRequestId: purchaseId,
        shopPurchaseId: purchaseId,
        walletTransactionId: input.walletTransactionId,
        ttsStatus: "pending",
      })
      .returning();
    const row = inserted[0];
    if (!row) {
      throw new Error("stream donation insert failed");
    }
    await tx
      .insert(jobs)
      .values({
        type: STREAM_ALERT_TTS_JOB_TYPE,
        owner: "worker",
        payload: { donation_id: row.id },
        idempotencyKey: `stream_alert.tts:${row.id}`,
      })
      .onConflictDoNothing({
        target: [jobs.type, jobs.idempotencyKey],
      });
    return { ...toView(row), replayed: false };
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const raced = await tx
      .select()
      .from(streamDonations)
      .where(eq(streamDonations.shopPurchaseId, purchaseId))
      .limit(1);
    const recovered = raced[0];
    if (!recovered) {
      throw error;
    }
    return { ...toView(recovered), replayed: true };
  }
}

export async function listMyStreamDonations(
  db: GiftbotDb,
  userId: string,
): Promise<StreamDonationView[]> {
  const rows = await db
    .select()
    .from(streamDonations)
    .where(eq(streamDonations.userId, userId))
    .orderBy(desc(streamDonations.createdAt))
    .limit(20);
  return rows.map(toView);
}

export async function listAdminStreamDonations(
  db: GiftbotDb,
): Promise<StreamDonationView[]> {
  const rows = await db
    .select()
    .from(streamDonations)
    .orderBy(desc(streamDonations.createdAt))
    .limit(STREAM_DONATION_ADMIN_LIMIT);
  return rows.map(toView);
}

async function recoverExpiredPlaying(
  tx: GiftbotTx,
  now: Date,
): Promise<number> {
  const cutoff = new Date(now.getTime() - STREAM_DONATION_PLAYING_LEASE_MS);
  const recovered = await tx
    .update(streamDonations)
    .set({
      status: "queued",
      startedAt: null,
      overlaySessionId: null,
      playingExpiresAt: null,
      queuedAt: now,
    })
    .where(
      and(
        eq(streamDonations.status, "playing"),
        or(
          lt(streamDonations.playingExpiresAt, now),
          and(
            isNull(streamDonations.playingExpiresAt),
            lt(streamDonations.startedAt, cutoff),
          ),
        ),
      ),
    )
    .returning({ id: streamDonations.id });
  return recovered.length;
}

export async function attachStreamAlertConsumer(
  db: GiftbotDb,
  input: { sessionId: string; clock?: Clock },
): Promise<{ sessionId: string; recovered: number }> {
  const sessionId = parseOverlaySessionId(input.sessionId);
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${"stream-alert-consumer"}))`,
    );
    const recovered = await recoverExpiredPlaying(tx, now);
    const rows = await tx.select().from(streamAlertConsumers).limit(1);
    const current = rows[0];
    const leaseUntil = new Date(now.getTime() + STREAM_ALERT_CONSUMER_LEASE_MS);
    if (
      current &&
      current.sessionId !== sessionId &&
      current.leaseExpiresAt > now
    ) {
      throw new OverlayBusyError();
    }
    if (!current) {
      await tx.insert(streamAlertConsumers).values({
        id: 1,
        sessionId,
        leaseExpiresAt: leaseUntil,
      });
    } else {
      await tx
        .update(streamAlertConsumers)
        .set({ sessionId, leaseExpiresAt: leaseUntil })
        .where(eq(streamAlertConsumers.id, 1));
    }
    return { sessionId, recovered };
  });
}

async function assertConsumerOwns(
  tx: GiftbotTx,
  sessionId: string,
  now: Date,
): Promise<void> {
  const rows = await tx.select().from(streamAlertConsumers).limit(1);
  const current = rows[0];
  if (
    !current ||
    current.sessionId !== sessionId ||
    current.leaseExpiresAt <= now
  ) {
    throw new OverlayBusyError();
  }
}

export async function claimNextStreamDonation(
  db: GiftbotDb,
  input: { sessionId: string; clock?: Clock },
): Promise<{ donation: StreamDonationView | null; recovered: number }> {
  const sessionId = parseOverlaySessionId(input.sessionId);
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${"stream-alert-consumer"}))`,
    );
    const recovered = await recoverExpiredPlaying(tx, now);
    await assertConsumerOwns(tx, sessionId, now);
    const playing = await tx
      .select()
      .from(streamDonations)
      .where(
        and(
          eq(streamDonations.status, "playing"),
          eq(streamDonations.overlaySessionId, sessionId),
        ),
      )
      .orderBy(asc(streamDonations.createdAt))
      .limit(1);
    const already = playing[0];
    if (already) {
      return { donation: toView(already), recovered };
    }
    const queued = await tx
      .select()
      .from(streamDonations)
      .where(eq(streamDonations.status, "queued"))
      .orderBy(asc(streamDonations.createdAt), asc(streamDonations.id))
      .limit(1)
      .for("update", { skipLocked: true });
    const next = queued[0];
    if (!next) {
      return { donation: null, recovered };
    }
    const holdMs = streamDonationPlayingHoldMs({
      ttsStatus: next.ttsStatus,
      ttsDurationMs: next.ttsDurationMs,
    });
    const updated = await tx
      .update(streamDonations)
      .set({
        status: "playing",
        startedAt: now,
        overlaySessionId: sessionId,
        playingExpiresAt: new Date(now.getTime() + holdMs),
      })
      .where(eq(streamDonations.id, next.id))
      .returning();
    const row = updated[0];
    return { donation: row ? toView(row) : null, recovered };
  });
}

export async function completeStreamDonation(
  db: GiftbotDb,
  input: { sessionId: string; donationId: string; clock?: Clock },
): Promise<StreamDonationView> {
  const sessionId = parseOverlaySessionId(input.sessionId);
  const donationId = parseStreamDonationId(input.donationId);
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  return db.transaction(async (tx) => {
    await assertConsumerOwns(tx, sessionId, now);
    const rows = await tx
      .select()
      .from(streamDonations)
      .where(eq(streamDonations.id, donationId))
      .limit(1)
      .for("update");
    const row = rows[0];
    if (!row) {
      throw new StreamDonationInvalidRequestError();
    }
    if (row.status === "finished") {
      return toView(row);
    }
    if (row.status !== "playing" || row.overlaySessionId !== sessionId) {
      throw new OverlayBusyError();
    }
    const updated = await tx
      .update(streamDonations)
      .set({
        status: "finished",
        finishedAt: now,
      })
      .where(eq(streamDonations.id, row.id))
      .returning();
    const next = updated[0];
    if (!next) {
      throw new Error("stream donation complete failed");
    }
    return toView(next);
  });
}

export async function recoverExpiredStreamDonations(
  db: GiftbotDb,
  input: { clock?: Clock } = {},
): Promise<number> {
  const clock = input.clock ?? systemClock;
  return db.transaction((tx) => recoverExpiredPlaying(tx, clock.now()));
}

export async function heartbeatStreamDonationPlaying(
  db: GiftbotDb,
  input: { sessionId: string; donationId: string; clock?: Clock },
): Promise<StreamDonationView> {
  const sessionId = parseOverlaySessionId(input.sessionId);
  const donationId = parseStreamDonationId(input.donationId);
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${"stream-alert-consumer"}))`,
    );
    await assertConsumerOwns(tx, sessionId, now);
    const leaseUntil = new Date(now.getTime() + STREAM_ALERT_CONSUMER_LEASE_MS);
    await tx
      .update(streamAlertConsumers)
      .set({ leaseExpiresAt: leaseUntil })
      .where(eq(streamAlertConsumers.id, 1));
    const rows = await tx
      .select()
      .from(streamDonations)
      .where(eq(streamDonations.id, donationId))
      .limit(1)
      .for("update");
    const row = rows[0];
    if (
      !row ||
      row.status !== "playing" ||
      row.overlaySessionId !== sessionId
    ) {
      throw new OverlayBusyError();
    }
    const started = row.startedAt ?? now;
    const maxUntil = new Date(started.getTime() + STREAM_ALERT_PLAYING_MAX_MS);
    const extended = new Date(now.getTime() + STREAM_ALERT_HEARTBEAT_EXTEND_MS);
    const playingExpiresAt = extended < maxUntil ? extended : maxUntil;
    const updated = await tx
      .update(streamDonations)
      .set({ playingExpiresAt })
      .where(eq(streamDonations.id, row.id))
      .returning();
    const next = updated[0];
    if (!next) {
      throw new Error("stream donation heartbeat failed");
    }
    return toView(next);
  });
}

export async function loadStreamDonationForTts(
  db: GiftbotDb,
  donationId: string,
): Promise<typeof streamDonations.$inferSelect | undefined> {
  const id = parseStreamDonationId(donationId);
  const rows = await db
    .select()
    .from(streamDonations)
    .where(eq(streamDonations.id, id))
    .limit(1);
  return rows[0];
}

export async function markStreamDonationTtsReady(
  db: GiftbotDb,
  input: { donationId: string; voice: string; durationMs: number },
): Promise<void> {
  const donationId = parseStreamDonationId(input.donationId);
  await db
    .update(streamDonations)
    .set({
      ttsStatus: "ready",
      ttsVoice: input.voice,
      ttsDurationMs: input.durationMs,
      ttsError: null,
      ttsGeneratedAt: new Date(),
    })
    .where(eq(streamDonations.id, donationId));
}

export async function markStreamDonationTtsTerminal(
  db: GiftbotDb,
  input: {
    donationId: string;
    status: "failed" | "skipped";
    error?: string;
  },
): Promise<void> {
  const donationId = parseStreamDonationId(input.donationId);
  await db
    .update(streamDonations)
    .set({
      ttsStatus: input.status,
      ttsError: input.error ?? null,
      ttsGeneratedAt: new Date(),
    })
    .where(eq(streamDonations.id, donationId));
}
