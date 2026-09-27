import {
  inventoryItems,
  jobs,
  kickAccounts,
  kickChatMessageApplications,
  kickStreamSessions,
  notifications,
  telegramAccounts,
  userKickStats,
  userLevelRewards,
  userProgress,
  userStreamParticipation,
  userStreamStreaks,
  wallets,
} from "@giftbot/db/schema";
import { and, asc, eq, gt, lt, sql } from "drizzle-orm";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import { computeLevel, rewardForReachedLevel } from "./level.js";
import { asBigInt } from "./money.js";
import { enqueueKickStreamStartBroadcastIn } from "./stream-start-notice.js";
import { applyIn } from "./wallet.js";

export const KICK_TARGET_CHANNEL = "azarov7777";
export const STREAM_QUALIFY_MESSAGES = 10;
export const MAX_STREAM_STREAK = 10;

export const STREAM_STREAK_REWARDS: ReadonlyArray<bigint> = Object.freeze([
  100n, 200n, 300n, 400n, 500n, 600n, 700n, 800n, 900n, 1000n,
]);

export function streakRewardFor(streakNumber: number): bigint | null {
  if (streakNumber < 1 || streakNumber > MAX_STREAM_STREAK) {
    return null;
  }
  return STREAM_STREAK_REWARDS[streakNumber - 1] ?? null;
}

/**
 * Lock order for chat message application (avoid deadlocks):
 * 1. inbound_events (caller)
 * 2. kick_chat_message_applications unique insert
 * 3. user_progress
 * 4. user_kick_stats
 * 5. kick_stream_sessions (live)
 * 6. user_stream_participation
 * 7. user_stream_streaks
 * 8. wallet (applyIn)
 */

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readId(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function normalizeChannel(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  return raw.replace(/^@/, "").trim().toLowerCase();
}

export function isChatMessageEventType(eventType: string): boolean {
  const t = eventType.toLowerCase();
  return (
    t === "chat.message.sent" ||
    t === "chat.message" ||
    t === "message" ||
    t.includes("chat.message")
  );
}

export function isLivestreamEventType(eventType: string): boolean {
  const t = eventType.toLowerCase();
  return (
    t === "livestream.status.updated" ||
    t === "livestream.updated" ||
    t.includes("livestream")
  );
}

export function parseChatMessagePayload(payload: unknown): {
  providerMessageId: string;
  kickUserId: string;
  channel: string;
} | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }
  const data = asRecord(root.data) ?? root;
  const message = asRecord(data.message) ?? asRecord(root.message);
  const sender =
    asRecord(data.sender) ??
    asRecord(data.user) ??
    asRecord(message?.sender) ??
    asRecord(root.sender) ??
    asRecord(root.user);
  const broadcaster =
    asRecord(data.broadcaster) ??
    asRecord(root.broadcaster) ??
    asRecord(data.channel);

  const providerMessageId =
    readString(data.message_id) ??
    readString(message?.id) ??
    readString(root.message_id) ??
    readString(root.provider_message_id) ??
    readString(root.id);
  const kickUserId =
    readId(sender?.user_id) ??
    readId(sender?.id) ??
    readId(data.user_id) ??
    readId(root.kick_user_id);
  const channel =
    normalizeChannel(readString(data.channel_slug)) ??
    normalizeChannel(readString(broadcaster?.channel_slug)) ??
    normalizeChannel(readString(broadcaster?.slug)) ??
    normalizeChannel(readString(broadcaster?.username)) ??
    normalizeChannel(readString(data.channel)) ??
    normalizeChannel(readString(root.channel));

  if (!providerMessageId || !kickUserId || !channel) {
    return null;
  }
  return { providerMessageId, kickUserId, channel };
}

export function parseLivestreamPayload(payload: unknown): {
  isLive: boolean;
  providerStreamId: string | null;
  channel: string;
} | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }
  const data = asRecord(root.data) ?? root;
  const livestream = asRecord(data.livestream) ?? asRecord(root.livestream);
  const broadcaster =
    asRecord(data.broadcaster) ??
    asRecord(root.broadcaster) ??
    asRecord(data.channel);

  const channel =
    normalizeChannel(readString(data.channel_slug)) ??
    normalizeChannel(readString(broadcaster?.channel_slug)) ??
    normalizeChannel(readString(broadcaster?.slug)) ??
    normalizeChannel(readString(broadcaster?.username)) ??
    normalizeChannel(readString(data.channel)) ??
    normalizeChannel(readString(root.channel)) ??
    KICK_TARGET_CHANNEL;

  let isLive: boolean | undefined;
  if (typeof data.is_live === "boolean") {
    isLive = data.is_live;
  } else if (typeof root.is_live === "boolean") {
    isLive = root.is_live;
  } else if (typeof livestream?.is_live === "boolean") {
    isLive = livestream.is_live;
  } else if (typeof data.live === "boolean") {
    isLive = data.live;
  } else {
    const status = (
      readString(data.status) ??
      readString(livestream?.status) ??
      readString(root.status)
    )?.toLowerCase();
    if (status === "live" || status === "online") {
      isLive = true;
    } else if (status === "offline" || status === "ended") {
      isLive = false;
    }
  }

  if (isLive === undefined) {
    return null;
  }

  const providerStreamId =
    readId(data.livestream_id) ??
    readId(livestream?.id) ??
    readId(root.provider_stream_id) ??
    readId(data.id) ??
    null;

  return { isLive, providerStreamId, channel };
}

async function ensureWallet(tx: GiftbotTx, userId: string): Promise<void> {
  const rows = await tx
    .select({ id: wallets.id })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  if (!rows[0]) {
    await tx.insert(wallets).values({ userId });
  }
}

async function ensureProgress(tx: GiftbotTx, userId: string) {
  await tx.insert(userProgress).values({ userId }).onConflictDoNothing();
  const rows = await tx
    .select()
    .from(userProgress)
    .where(eq(userProgress.userId, userId))
    .for("update")
    .limit(1);
  if (!rows[0]) {
    throw new Error("failed to lock user_progress");
  }
  return rows[0];
}

async function ensureKickStats(tx: GiftbotTx, userId: string) {
  await tx.insert(userKickStats).values({ userId }).onConflictDoNothing();
  const rows = await tx
    .select()
    .from(userKickStats)
    .where(eq(userKickStats.userId, userId))
    .for("update")
    .limit(1);
  if (!rows[0]) {
    throw new Error("failed to lock user_kick_stats");
  }
  return rows[0];
}

async function ensureStreak(tx: GiftbotTx, userId: string) {
  await tx.insert(userStreamStreaks).values({ userId }).onConflictDoNothing();
  const rows = await tx
    .select()
    .from(userStreamStreaks)
    .where(eq(userStreamStreaks.userId, userId))
    .for("update")
    .limit(1);
  if (!rows[0]) {
    throw new Error("failed to lock user_stream_streaks");
  }
  return rows[0];
}

async function insertInbox(
  tx: GiftbotTx,
  input: {
    userId: string;
    type: string;
    title: string;
    body: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(notifications).values({
    userId: input.userId,
    channel: "inbox",
    type: input.type,
    status: "sent",
    title: input.title,
    body: input.body,
    sentAt: new Date(),
    payload: input.payload,
  });
}

async function enqueueTelegramNotice(
  tx: GiftbotTx,
  input: { userId: string; idempotencyKey: string; text: string },
): Promise<void> {
  const rows = await tx
    .select({ telegramUserId: telegramAccounts.telegramUserId })
    .from(telegramAccounts)
    .where(
      and(
        eq(telegramAccounts.userId, input.userId),
        eq(telegramAccounts.isActive, true),
      ),
    )
    .limit(1);
  const chatId = rows[0]?.telegramUserId;
  if (chatId === undefined || chatId === null) {
    return;
  }
  await tx
    .insert(jobs)
    .values({
      type: "telegram.send_message",
      owner: "bot",
      payload: { chat_id: Number(chatId), text: input.text },
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing({ target: [jobs.type, jobs.idempotencyKey] });
}

async function enqueueFinalizeJob(
  tx: GiftbotTx,
  streamSessionId: string,
  afterUserId: string | null,
): Promise<void> {
  const cursorKey = afterUserId ?? "start";
  await tx
    .insert(jobs)
    .values({
      type: "kick.finalize_stream_session",
      owner: "worker",
      payload: {
        stream_session_id: streamSessionId,
        after_user_id: afterUserId,
      },
      idempotencyKey: `kick.finalize_stream:${streamSessionId}:after:${cursorKey}`,
    })
    .onConflictDoNothing({ target: [jobs.type, jobs.idempotencyKey] });
}

async function grantLevelRewardsIn(
  tx: GiftbotTx,
  input: { userId: string; previousLevel: number; newLevel: number },
): Promise<Array<{ reachedLevel: number; rewardAzc: string }>> {
  const granted: Array<{ reachedLevel: number; rewardAzc: string }> = [];
  if (input.newLevel <= input.previousLevel) {
    return granted;
  }
  await ensureWallet(tx, input.userId);
  for (let level = input.previousLevel + 1; level <= input.newLevel; level += 1) {
    const reward = rewardForReachedLevel(level);
    if (!reward) {
      continue;
    }
    const existing = await tx
      .select({ id: userLevelRewards.id })
      .from(userLevelRewards)
      .where(
        and(
          eq(userLevelRewards.userId, input.userId),
          eq(userLevelRewards.reachedLevel, level),
        ),
      )
      .limit(1);
    if (existing[0]) {
      continue;
    }
    const paid = await applyIn(tx, {
      userId: input.userId,
      type: "level_reward",
      amountMinor: reward,
      idempotencyKey: `level.reward:${input.userId}:${level}`,
      actorType: "system",
      reason: `Награда за ${level} уровень`,
      referenceType: "level",
      metadata: { reachedLevel: level },
    });
    await tx.insert(userLevelRewards).values({
      userId: input.userId,
      reachedLevel: level,
      rewardAzc: reward,
      rewardTransactionId: paid.transaction.id,
    });
    await insertInbox(tx, {
      userId: input.userId,
      type: "level_reached",
      title: "Новый уровень!",
      body: `Ты достиг ${level} уровня и получил ${reward.toString()} AZC`,
      payload: { reachedLevel: level, rewardAzc: reward.toString() },
    });
    await enqueueTelegramNotice(tx, {
      userId: input.userId,
      idempotencyKey: `level.reward.notify:${input.userId}:${level}`,
      text: `Новый уровень! Ты достиг ${level} уровня и получил ${reward.toString()} AZC`,
    });
    granted.push({ reachedLevel: level, rewardAzc: reward.toString() });
  }
  return granted;
}

/** Trusted multi-cross path for import/admin/tests — same grants as chat XP. */
export async function grantLevelRewards(
  db: GiftbotDb,
  input: { userId: string; previousLevel: number; newLevel: number },
): Promise<Array<{ reachedLevel: number; rewardAzc: string }>> {
  return db.transaction((tx) => grantLevelRewardsIn(tx, input));
}

export async function getLiveStreamSession(
  db: GiftbotDb | GiftbotTx,
  channel: string = KICK_TARGET_CHANNEL,
) {
  const rows = await db
    .select()
    .from(kickStreamSessions)
    .where(
      and(
        eq(kickStreamSessions.channel, channel),
        eq(kickStreamSessions.status, "live"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function startKickStreamSessionIn(
  tx: GiftbotTx,
  input: {
    channel?: string;
    providerStreamId?: string | null;
  } = {},
): Promise<{
  sessionId: string;
  created: boolean;
  broadcastRecipientCount: number;
}> {
  const channel = normalizeChannel(input.channel) ?? KICK_TARGET_CHANNEL;
  const live = await tx
    .select()
    .from(kickStreamSessions)
    .where(
      and(
        eq(kickStreamSessions.channel, channel),
        eq(kickStreamSessions.status, "live"),
      ),
    )
    .for("update")
    .limit(1);
  if (live[0]) {
    if (input.providerStreamId && !live[0].providerStreamId) {
      await tx
        .update(kickStreamSessions)
        .set({ providerStreamId: input.providerStreamId })
        .where(eq(kickStreamSessions.id, live[0].id));
    }
    return {
      sessionId: live[0].id,
      created: false,
      broadcastRecipientCount: 0,
    };
  }
  const inserted = await tx
    .insert(kickStreamSessions)
    .values({
      channel,
      status: "live",
      ...(input.providerStreamId
        ? { providerStreamId: input.providerStreamId }
        : {}),
    })
    .returning();
  const row = inserted[0];
  if (!row) {
    throw new Error("failed to create stream session");
  }
  const broadcastRecipientCount = await enqueueKickStreamStartBroadcastIn(tx, {
    sessionId: row.id,
  });
  return {
    sessionId: row.id,
    created: true,
    broadcastRecipientCount,
  };
}

export async function startKickStreamSession(
  db: GiftbotDb,
  input: {
    channel?: string;
    providerStreamId?: string | null;
  } = {},
): Promise<{
  sessionId: string;
  created: boolean;
  broadcastRecipientCount: number;
}> {
  return db.transaction((tx) => startKickStreamSessionIn(tx, input));
}

export async function endKickStreamSessionIn(
  tx: GiftbotTx,
  input: { channel?: string; providerStreamId?: string | null } = {},
): Promise<{ sessionId: string | null; ended: boolean }> {
  const channel = normalizeChannel(input.channel) ?? KICK_TARGET_CHANNEL;
  let live = await tx
    .select()
    .from(kickStreamSessions)
    .where(
      and(
        eq(kickStreamSessions.channel, channel),
        eq(kickStreamSessions.status, "live"),
      ),
    )
    .for("update")
    .limit(1);
  if (!live[0] && input.providerStreamId) {
    live = await tx
      .select()
      .from(kickStreamSessions)
      .where(eq(kickStreamSessions.providerStreamId, input.providerStreamId))
      .for("update")
      .limit(1);
  }
  const session = live[0];
  if (!session) {
    return { sessionId: null, ended: false };
  }
  if (session.status === "ended") {
    return { sessionId: session.id, ended: false };
  }
  await tx
    .update(kickStreamSessions)
    .set({
      status: "ended",
      endedAt: new Date(),
      finalizationStatus: "pending",
    })
    .where(eq(kickStreamSessions.id, session.id));
  await enqueueFinalizeJob(tx, session.id, null);
  return { sessionId: session.id, ended: true };
}

export async function endKickStreamSession(
  db: GiftbotDb,
  input: { channel?: string; providerStreamId?: string | null } = {},
): Promise<{ sessionId: string | null; ended: boolean }> {
  return db.transaction((tx) => endKickStreamSessionIn(tx, input));
}

export type ApplyChatMessageResult = {
  applied: boolean;
  replayed: boolean;
  ignoredReason?: string;
  xpAwarded?: number;
  streak?: number;
  streakRewardAzc?: string;
  levelGrants?: Array<{ reachedLevel: number; rewardAzc: string }>;
};

export async function applyKickChatMessageIn(
  tx: GiftbotTx,
  input: {
    providerMessageId: string;
    kickUserId: string;
    channel: string;
    inboundEventId?: string;
  },
): Promise<ApplyChatMessageResult> {
  const channel = normalizeChannel(input.channel);
  if (channel !== KICK_TARGET_CHANNEL) {
    return { applied: false, replayed: false, ignoredReason: "wrong_channel" };
  }

  const existingApp = await tx
    .select({ id: kickChatMessageApplications.id })
    .from(kickChatMessageApplications)
    .where(eq(kickChatMessageApplications.providerMessageId, input.providerMessageId))
    .limit(1);
  if (existingApp[0]) {
    return { applied: false, replayed: true };
  }

  const accounts = await tx
    .select()
    .from(kickAccounts)
    .where(
      and(
        eq(kickAccounts.kickUserId, input.kickUserId),
        eq(kickAccounts.status, "active"),
      ),
    )
    .limit(1);
  const account = accounts[0];
  if (!account) {
    return { applied: false, replayed: false, ignoredReason: "unlinked" };
  }

  const live = await tx
    .select()
    .from(kickStreamSessions)
    .where(
      and(
        eq(kickStreamSessions.channel, KICK_TARGET_CHANNEL),
        eq(kickStreamSessions.status, "live"),
      ),
    )
    .for("update")
    .limit(1);
  const session = live[0];
  if (!session) {
    return { applied: false, replayed: false, ignoredReason: "not_live" };
  }

  try {
    await tx.insert(kickChatMessageApplications).values({
      providerMessageId: input.providerMessageId,
      userId: account.userId,
      streamSessionId: session.id,
      ...(input.inboundEventId ? { inboundEventId: input.inboundEventId } : {}),
      xpAwarded: 1,
    });
  } catch {
    return { applied: false, replayed: true };
  }

  const progress = await ensureProgress(tx, account.userId);
  const stats = await ensureKickStats(tx, account.userId);
  const oldXp = asBigInt(progress.totalXp);
  const previousLevel = computeLevel(oldXp).current;
  const newXp = oldXp + 1n;

  await tx
    .update(userProgress)
    .set({ totalXp: newXp, updatedAt: new Date() })
    .where(eq(userProgress.userId, account.userId));
  await tx
    .update(userKickStats)
    .set({
      chatMessagesCounted: asBigInt(stats.chatMessagesCounted) + 1n,
      updatedAt: new Date(),
    })
    .where(eq(userKickStats.userId, account.userId));

  await tx
    .insert(userStreamParticipation)
    .values({
      userId: account.userId,
      streamSessionId: session.id,
      messageCount: 0,
    })
    .onConflictDoNothing();

  const partRows = await tx
    .select()
    .from(userStreamParticipation)
    .where(
      and(
        eq(userStreamParticipation.userId, account.userId),
        eq(userStreamParticipation.streamSessionId, session.id),
      ),
    )
    .for("update")
    .limit(1);
  const part = partRows[0];
  if (!part) {
    throw new Error("failed to lock participation");
  }

  const nextCount = part.messageCount + 1;
  let streakRewardAzc: string | undefined;
  let streakValue: number | undefined;

  await tx
    .update(userStreamParticipation)
    .set({
      messageCount: nextCount,
      updatedAt: new Date(),
    })
    .where(eq(userStreamParticipation.id, part.id));

  if (nextCount >= STREAM_QUALIFY_MESSAGES && !part.qualifiedAt) {
    const streak = await ensureStreak(tx, account.userId);
    if (streak.currentStreak < MAX_STREAM_STREAK) {
      const newStreak = streak.currentStreak + 1;
      const reward = streakRewardFor(newStreak);
      const now = new Date();
      await tx
        .update(userStreamParticipation)
        .set({
          qualifiedAt: now,
          streakAction: "rewarded",
          rewardAzc: reward ?? undefined,
          updatedAt: now,
        })
        .where(eq(userStreamParticipation.id, part.id));

      await tx
        .update(userStreamStreaks)
        .set({
          currentStreak: newStreak,
          ...(newStreak === MAX_STREAM_STREAK ? { completedAt: now } : {}),
          lastQualifiedStreamId: session.id,
          updatedAt: now,
        })
        .where(eq(userStreamStreaks.userId, account.userId));

      if (reward) {
        await ensureWallet(tx, account.userId);
        await applyIn(tx, {
          userId: account.userId,
          type: "stream_streak_reward",
          amountMinor: reward,
          idempotencyKey: `stream.streak.reward:${account.userId}:${session.id}`,
          actorType: "system",
          reason: `Награда за серию стримов ${newStreak}`,
          referenceType: "kick_stream_session",
          referenceId: session.id,
          metadata: { streak: newStreak },
        });
        await insertInbox(tx, {
          userId: account.userId,
          type: "stream_streak_reward",
          title: "Серия стримов",
          body: `+${reward.toString()} AZC за ${newStreak} стримов подряд`,
          payload: {
            streak: newStreak,
            rewardAzc: reward.toString(),
            streamSessionId: session.id,
          },
        });
        streakRewardAzc = reward.toString();
      }
      streakValue = newStreak;
    } else {
      await tx
        .update(userStreamParticipation)
        .set({
          qualifiedAt: new Date(),
          streakAction: "noop_completed",
          updatedAt: new Date(),
        })
        .where(eq(userStreamParticipation.id, part.id));
      streakValue = streak.currentStreak;
    }
  }

  const newLevel = computeLevel(newXp).current;
  const levelGrants = await grantLevelRewardsIn(tx, {
    userId: account.userId,
    previousLevel,
    newLevel,
  });

  const { evaluateAchievementsIn } = await import("./achievements.js");
  await evaluateAchievementsIn(tx, account.userId);

  return {
    applied: true,
    replayed: false,
    xpAwarded: 1,
    ...(streakValue !== undefined ? { streak: streakValue } : {}),
    ...(streakRewardAzc ? { streakRewardAzc } : {}),
    ...(levelGrants.length > 0 ? { levelGrants } : {}),
  };
}

export async function applyKickChatMessage(
  db: GiftbotDb,
  input: {
    providerMessageId: string;
    kickUserId: string;
    channel: string;
    inboundEventId?: string;
  },
): Promise<ApplyChatMessageResult> {
  return db.transaction((tx) => applyKickChatMessageIn(tx, input));
}

async function consumeOneFreeze(
  tx: GiftbotTx,
  userId: string,
  streamSessionId: string,
): Promise<string | null> {
  const rows = await tx
    .select()
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.userId, userId),
        eq(inventoryItems.itemType, "streak_freeze"),
        eq(inventoryItems.status, "available"),
        gt(inventoryItems.quantity, 0),
      ),
    )
    .orderBy(asc(inventoryItems.createdAt))
    .for("update")
    .limit(1);
  const item = rows[0];
  if (!item) {
    return null;
  }
  const qty = item.quantity;
  const meta = {
    ...(typeof item.metadata === "object" && item.metadata !== null
      ? (item.metadata as Record<string, unknown>)
      : {}),
    consumedAt: new Date().toISOString(),
    streamSessionId,
    reason: "missed_stream_freeze",
  };
  if (qty > 1) {
    await tx
      .update(inventoryItems)
      .set({ quantity: qty - 1, metadata: meta })
      .where(eq(inventoryItems.id, item.id));
  } else {
    await tx
      .update(inventoryItems)
      .set({ status: "consumed", metadata: meta })
      .where(eq(inventoryItems.id, item.id));
  }
  return item.id;
}

const FINALIZE_BATCH = 50;

export async function finalizeKickStreamSession(
  db: GiftbotDb,
  streamSessionId: string,
): Promise<{ done: boolean; processed: number }> {
  return db.transaction(async (tx) => {
    const sessions = await tx
      .select()
      .from(kickStreamSessions)
      .where(eq(kickStreamSessions.id, streamSessionId))
      .for("update")
      .limit(1);
    const session = sessions[0];
    if (!session) {
      return { done: true, processed: 0 };
    }
    if (session.finalizationStatus === "completed") {
      return { done: true, processed: 0 };
    }
    if (session.status !== "ended") {
      await tx
        .update(kickStreamSessions)
        .set({
          status: "ended",
          endedAt: session.endedAt ?? new Date(),
          finalizationStatus: "running",
        })
        .where(eq(kickStreamSessions.id, session.id));
    } else {
      await tx
        .update(kickStreamSessions)
        .set({ finalizationStatus: "running" })
        .where(eq(kickStreamSessions.id, session.id));
    }

    const cursor = session.finalizationCursorUserId;
    const streakUsers = await tx
      .select()
      .from(userStreamStreaks)
      .where(
        and(
          gt(userStreamStreaks.currentStreak, 0),
          lt(userStreamStreaks.currentStreak, MAX_STREAM_STREAK),
          ...(cursor ? [gt(userStreamStreaks.userId, cursor)] : []),
        ),
      )
      .orderBy(asc(userStreamStreaks.userId))
      .limit(FINALIZE_BATCH);

    if (streakUsers.length === 0) {
      await tx
        .update(kickStreamSessions)
        .set({
          finalizationStatus: "completed",
          finalizationCursorUserId: null,
        })
        .where(eq(kickStreamSessions.id, session.id));
      return { done: true, processed: 0 };
    }

    let lastUserId: string | null = null;
    for (const streak of streakUsers) {
      lastUserId = streak.userId;
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`stream-finalize:${session.id}:${streak.userId}`}))`,
      );
      const lockedStreak = await ensureStreak(tx, streak.userId);
      if (
        lockedStreak.currentStreak <= 0 ||
        lockedStreak.currentStreak >= MAX_STREAM_STREAK
      ) {
        continue;
      }
      if (lockedStreak.lastFinalizedStreamId === session.id) {
        continue;
      }
      if (lockedStreak.lastQualifiedStreamId === session.id) {
        await tx
          .update(userStreamStreaks)
          .set({
            lastFinalizedStreamId: session.id,
            updatedAt: new Date(),
          })
          .where(eq(userStreamStreaks.userId, streak.userId));
        await tx
          .insert(userStreamParticipation)
          .values({
            userId: streak.userId,
            streamSessionId: session.id,
            messageCount: 0,
            finalizedAt: new Date(),
            streakAction: "qualified",
          })
          .onConflictDoNothing();
        const parts = await tx
          .select()
          .from(userStreamParticipation)
          .where(
            and(
              eq(userStreamParticipation.userId, streak.userId),
              eq(userStreamParticipation.streamSessionId, session.id),
            ),
          )
          .for("update")
          .limit(1);
        if (parts[0] && !parts[0].finalizedAt) {
          await tx
            .update(userStreamParticipation)
            .set({
              finalizedAt: new Date(),
              updatedAt: new Date(),
              streakAction: parts[0].streakAction ?? "qualified",
            })
            .where(eq(userStreamParticipation.id, parts[0].id));
        }
        continue;
      }

      await tx
        .insert(userStreamParticipation)
        .values({
          userId: streak.userId,
          streamSessionId: session.id,
          messageCount: 0,
        })
        .onConflictDoNothing();
      const parts = await tx
        .select()
        .from(userStreamParticipation)
        .where(
          and(
            eq(userStreamParticipation.userId, streak.userId),
            eq(userStreamParticipation.streamSessionId, session.id),
          ),
        )
        .for("update")
        .limit(1);
      const part = parts[0];
      if (!part) {
        continue;
      }
      if (part.finalizedAt) {
        continue;
      }
      if (part.qualifiedAt) {
        await tx
          .update(userStreamParticipation)
          .set({ finalizedAt: new Date(), updatedAt: new Date() })
          .where(eq(userStreamParticipation.id, part.id));
        await tx
          .update(userStreamStreaks)
          .set({
            lastFinalizedStreamId: session.id,
            updatedAt: new Date(),
          })
          .where(eq(userStreamStreaks.userId, streak.userId));
        continue;
      }

      const freezeId = await consumeOneFreeze(tx, streak.userId, session.id);
      if (freezeId) {
        await tx
          .update(userStreamParticipation)
          .set({
            finalizedAt: new Date(),
            streakAction: "freeze_consumed",
            freezeInventoryItemId: freezeId,
            updatedAt: new Date(),
          })
          .where(eq(userStreamParticipation.id, part.id));
        await tx
          .update(userStreamStreaks)
          .set({
            lastFinalizedStreamId: session.id,
            updatedAt: new Date(),
          })
          .where(eq(userStreamStreaks.userId, streak.userId));
        await insertInbox(tx, {
          userId: streak.userId,
          type: "stream_streak_freeze",
          title: "Заморозка стрика",
          body: "Стрик сохранён — использована 1 заморозка",
          payload: { streamSessionId: session.id, freezeInventoryItemId: freezeId },
        });
      } else {
        await tx
          .update(userStreamParticipation)
          .set({
            finalizedAt: new Date(),
            streakAction: "reset",
            updatedAt: new Date(),
          })
          .where(eq(userStreamParticipation.id, part.id));
        await tx
          .update(userStreamStreaks)
          .set({
            currentStreak: 0,
            lastFinalizedStreamId: session.id,
            updatedAt: new Date(),
          })
          .where(eq(userStreamStreaks.userId, streak.userId));
        await insertInbox(tx, {
          userId: streak.userId,
          type: "stream_streak_reset",
          title: "Стрик сброшен",
          body: "Ты пропустил стрим без заморозки",
          payload: { streamSessionId: session.id },
        });
      }
    }

    const more = await tx
      .select({ userId: userStreamStreaks.userId })
      .from(userStreamStreaks)
      .where(
        and(
          gt(userStreamStreaks.currentStreak, 0),
          lt(userStreamStreaks.currentStreak, MAX_STREAM_STREAK),
          ...(lastUserId ? [gt(userStreamStreaks.userId, lastUserId)] : []),
        ),
      )
      .limit(1);

    if (more[0]) {
      await tx
        .update(kickStreamSessions)
        .set({
          finalizationStatus: "pending",
          finalizationCursorUserId: lastUserId,
        })
        .where(eq(kickStreamSessions.id, session.id));
      await enqueueFinalizeJob(tx, session.id, lastUserId);
      return { done: false, processed: streakUsers.length };
    }

    await tx
      .update(kickStreamSessions)
      .set({
        finalizationStatus: "completed",
        finalizationCursorUserId: null,
      })
      .where(eq(kickStreamSessions.id, session.id));
    return { done: true, processed: streakUsers.length };
  });
}

export async function readStreamStreakState(db: GiftbotDb, userId: string) {
  const [streakRows, freezeRows, live, partRows] = await Promise.all([
    db
      .select()
      .from(userStreamStreaks)
      .where(eq(userStreamStreaks.userId, userId))
      .limit(1),
    db
      .select({
        quantity: inventoryItems.quantity,
      })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.userId, userId),
          eq(inventoryItems.itemType, "streak_freeze"),
          eq(inventoryItems.status, "available"),
        ),
      ),
    getLiveStreamSession(db),
    db
      .select()
      .from(userStreamParticipation)
      .where(eq(userStreamParticipation.userId, userId)),
  ]);

  const currentStreak = streakRows[0]?.currentStreak ?? 0;
  const completed = currentStreak >= MAX_STREAM_STREAK;
  const freezeCount = freezeRows.reduce((sum, row) => sum + row.quantity, 0);
  const nextTarget = completed ? null : currentStreak + 1;
  const nextReward = nextTarget ? streakRewardFor(nextTarget) : null;

  let stream:
    | {
        isLive: true;
        sessionId: string;
        messages: number;
        requiredMessages: number;
        qualified: boolean;
      }
    | { isLive: false } = { isLive: false };

  if (live) {
    const part = partRows.find((row) => row.streamSessionId === live.id);
    const messages = part?.messageCount ?? 0;
    stream = {
      isLive: true,
      sessionId: live.id,
      messages,
      requiredMessages: STREAM_QUALIFY_MESSAGES,
      qualified: Boolean(part?.qualifiedAt) || messages >= STREAM_QUALIFY_MESSAGES,
    };
  }

  return {
    currentStreak,
    completed,
    nextTarget,
    nextRewardAzc: nextReward?.toString() ?? null,
    freezeCount,
    stream,
  };
}

export async function countAvailableStreakFreezes(
  db: GiftbotDb,
  userId: string,
): Promise<number> {
  const rows = await db
    .select({ quantity: inventoryItems.quantity })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.userId, userId),
        eq(inventoryItems.itemType, "streak_freeze"),
        eq(inventoryItems.status, "available"),
      ),
    );
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}
