import {
  inboundEvents,
  inventoryItems,
  jobs,
  kickChatMessageApplications,
  userKickStats,
  userLevelRewards,
  userProgress,
  userStreamParticipation,
  userStreamStreaks,
  walletTransactions,
  wallets,
} from "@giftbot/db/schema";
import { eq, sql } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import {
  STREAM_STREAK_REWARDS,
  applyKickChatMessage,
  endKickStreamSession,
  finalizeKickStreamSession,
  grantLevelRewards,
  parseChatMessagePayload,
  readStreamStreakState,
  startKickStreamSession,
  streakRewardFor,
  KICK_TARGET_CHANNEL,
} from "./stream-xp.js";
import { applyKickInboundEvent, extractKickUserIds, linkKickAccount } from "./kick.js";
import { rewardForReachedLevel } from "./level.js";
import { provisionUser } from "./user.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

async function setupLinkedUser(suffix: string) {
  const user = await provisionUser(harness.db);
  const kickUserId = `kick-xp-${suffix}`;
  await linkKickAccount(harness.db, { userId: user.userId, kickUserId });
  return { userId: user.userId, kickUserId };
}

async function grantFreeze(userId: string, quantity = 1): Promise<string> {
  const inserted = await harness.db
    .insert(inventoryItems)
    .values({
      userId,
      itemType: "streak_freeze",
      title: "Streak Freeze",
      quantity,
      status: "available",
      source: "test",
    })
    .returning({ id: inventoryItems.id });
  const id = inserted[0]?.id;
  assert.ok(id);
  return id;
}

async function setStreak(userId: string, currentStreak: number): Promise<void> {
  await harness.db
    .insert(userStreamStreaks)
    .values({
      userId,
      currentStreak,
      ...(currentStreak >= 10 ? { completedAt: new Date() } : {}),
    })
    .onConflictDoUpdate({
      target: userStreamStreaks.userId,
      set: {
        currentStreak,
        ...(currentStreak >= 10
          ? { completedAt: new Date() }
          : { completedAt: null }),
        updatedAt: new Date(),
      },
    });
}

async function setTotalXp(userId: string, totalXp: bigint): Promise<void> {
  await harness.db
    .insert(userProgress)
    .values({ userId, totalXp })
    .onConflictDoUpdate({
      target: userProgress.userId,
      set: { totalXp, updatedAt: new Date() },
    });
}

async function walletBalance(userId: string): Promise<bigint> {
  const rows = await harness.db
    .select({ balance: wallets.balanceMinor })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  return BigInt(rows[0]?.balance ?? 0);
}

async function ledgerSum(userId: string): Promise<bigint> {
  const rows = await harness.db
    .select({
      s: sql<string>`coalesce(sum(${walletTransactions.amountMinor}), 0)::text`,
    })
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, userId));
  return BigInt(rows[0]?.s ?? "0");
}

async function sendMessages(
  kickUserId: string,
  count: number,
  prefix: string,
) {
  const results = [];
  for (let i = 0; i < count; i += 1) {
    results.push(
      await applyKickChatMessage(harness.db, {
        providerMessageId: `${prefix}-${i}`,
        kickUserId,
        channel: KICK_TARGET_CHANNEL,
      }),
    );
  }
  return results;
}

async function endAndFinalize(providerStreamId?: string): Promise<void> {
  const ended = await endKickStreamSession(
    harness.db,
    providerStreamId ? { providerStreamId } : {},
  );
  if (!ended.sessionId) {
    return;
  }
  let guard = 0;
  while (guard < 50) {
    const result = await finalizeKickStreamSession(harness.db, ended.sessionId);
    if (result.done) {
      return;
    }
    guard += 1;
  }
  throw new Error("finalize did not complete");
}

async function freshStream(providerStreamId: string) {
  await endAndFinalize();
  return startKickStreamSession(harness.db, { providerStreamId });
}

test("streak rewards are exact 100..1000 totaling 5500", () => {
  assert.equal(STREAM_STREAK_REWARDS.length, 10);
  let total = 0n;
  for (let i = 1; i <= 10; i += 1) {
    assert.equal(streakRewardFor(i), BigInt(i * 100));
    total += streakRewardFor(i)!;
  }
  assert.equal(total, 5500n);
  assert.equal(streakRewardFor(11), null);
});

const KICK_WEBHOOK_CHAT = {
  sender: {
    user_id: 129057484,
    username: "testuser",
  },
  broadcaster: {
    user_id: 37093990,
    username: "azarov7777",
    channel_slug: "azarov7777",
  },
  message_id: "test-message-id",
  content: "hello",
} as const;

test("parseChatMessagePayload accepts numeric Kick sender.user_id from real webhook", () => {
  const parsed = parseChatMessagePayload(KICK_WEBHOOK_CHAT);
  assert.deepEqual(parsed, {
    providerMessageId: "test-message-id",
    kickUserId: "129057484",
    channel: "azarov7777",
  });
  assert.deepEqual(
    parseChatMessagePayload({
      sender: { id: 129057484 },
      broadcaster: { channel_slug: "azarov7777" },
      message_id: "by-sender-id",
    }),
    {
      providerMessageId: "by-sender-id",
      kickUserId: "129057484",
      channel: "azarov7777",
    },
  );
  assert.deepEqual(
    parseChatMessagePayload({
      sender: { user_id: "129057484" },
      broadcaster: { channel_slug: "azarov7777" },
      message_id: "string-id",
    }),
    {
      providerMessageId: "string-id",
      kickUserId: "129057484",
      channel: "azarov7777",
    },
  );
  assert.ok(
    extractKickUserIds(KICK_WEBHOOK_CHAT).includes("129057484"),
  );
});

async function applyKickChatWebhook(input: {
  externalEventId: string;
  messageId: string;
  senderUserId: number;
}): Promise<void> {
  const inserted = await harness.db
    .insert(inboundEvents)
    .values({
      provider: "kick",
      eventType: "chat.message.sent",
      externalEventId: input.externalEventId,
      idempotencyKey: `kick:${input.externalEventId}`,
      payload: {
        sender: {
          user_id: input.senderUserId,
          username: "testuser",
        },
        broadcaster: {
          user_id: 37093990,
          username: "azarov7777",
          channel_slug: "azarov7777",
        },
        message_id: input.messageId,
        content: "hello",
      },
      signatureValid: true,
    })
    .returning({ id: inboundEvents.id });
  const eventId = inserted[0]?.id;
  assert.ok(eventId);
  await applyKickInboundEvent(harness.db, eventId);
}

test("valid live chat message awards XP and counts once", async () => {
  const { userId, kickUserId } = await setupLinkedUser("msg-1");
  await freshStream("stream-msg-1");
  const first = await applyKickChatMessage(harness.db, {
    providerMessageId: "pmid-msg-1",
    kickUserId,
    channel: KICK_TARGET_CHANNEL,
  });
  const replay = await applyKickChatMessage(harness.db, {
    providerMessageId: "pmid-msg-1",
    kickUserId,
    channel: KICK_TARGET_CHANNEL,
  });
  assert.equal(first.applied, true);
  assert.equal(first.xpAwarded, 1);
  assert.equal(replay.replayed, true);
  const progress = (
    await harness.db
      .select()
      .from(userProgress)
      .where(eq(userProgress.userId, userId))
  )[0];
  const stats = (
    await harness.db
      .select()
      .from(userKickStats)
      .where(eq(userKickStats.userId, userId))
  )[0];
  assert.equal(String(progress?.totalXp), "1");
  assert.equal(String(stats?.chatMessagesCounted), "1");
});

test("unlinked / wrong channel / offline messages are ignored", async () => {
  const { kickUserId } = await setupLinkedUser("ignore-1");
  const unlinked = await applyKickChatMessage(harness.db, {
    providerMessageId: "pmid-unlinked",
    kickUserId: "nobody-linked",
    channel: KICK_TARGET_CHANNEL,
  });
  assert.equal(unlinked.ignoredReason, "unlinked");

  await freshStream("stream-ignore-1");
  const wrong = await applyKickChatMessage(harness.db, {
    providerMessageId: "pmid-wrong-ch",
    kickUserId,
    channel: "otherchannel",
  });
  assert.equal(wrong.ignoredReason, "wrong_channel");

  await endAndFinalize("stream-ignore-1");
  const offline = await applyKickChatMessage(harness.db, {
    providerMessageId: "pmid-offline",
    kickUserId,
    channel: KICK_TARGET_CHANNEL,
  });
  assert.equal(offline.ignoredReason, "not_live");
});

test("10th message qualifies streak once with reward", async () => {
  const { userId, kickUserId } = await setupLinkedUser("qual-1");
  await freshStream("stream-qual-1");
  await sendMessages(kickUserId, 9, "qual-1");
  const before = await readStreamStreakState(harness.db, userId);
  assert.equal(before.currentStreak, 0);
  assert.equal(before.stream.isLive && before.stream.messages, 9);

  const tenth = await applyKickChatMessage(harness.db, {
    providerMessageId: "qual-1-9",
    kickUserId,
    channel: KICK_TARGET_CHANNEL,
  });
  assert.equal(tenth.streak, 1);
  assert.equal(tenth.streakRewardAzc, "100");
  const after = await readStreamStreakState(harness.db, userId);
  assert.equal(after.currentStreak, 1);
  assert.equal(after.stream.isLive && after.stream.qualified, true);
  assert.equal(await walletBalance(userId), 100n);

  const eleventh = await applyKickChatMessage(harness.db, {
    providerMessageId: "qual-1-10",
    kickUserId,
    channel: KICK_TARGET_CHANNEL,
  });
  assert.equal(eleventh.streak, undefined);
  assert.equal(await walletBalance(userId), 100n);
});

test("numeric Kick webhook sender.user_id applies chat streak once", async () => {
  const senderUserId = 129057484;
  const kickUserId = String(senderUserId);
  const user = await provisionUser(harness.db);
  await linkKickAccount(harness.db, { userId: user.userId, kickUserId });
  await freshStream("stream-numeric-sender");

  for (let i = 1; i <= 10; i += 1) {
    await applyKickChatWebhook({
      externalEventId: `numeric-chat-${i}`,
      messageId: `numeric-msg-${i}`,
      senderUserId,
    });
    const state = await readStreamStreakState(harness.db, user.userId);
    assert.equal(state.stream.isLive && state.stream.messages, i);
    if (i < 10) {
      assert.equal(state.currentStreak, 0);
      assert.equal(state.stream.isLive && state.stream.qualified, false);
    }
  }

  const applications = await harness.db
    .select()
    .from(kickChatMessageApplications)
    .where(eq(kickChatMessageApplications.userId, user.userId));
  assert.equal(applications.length, 10);

  const qualified = await readStreamStreakState(harness.db, user.userId);
  assert.equal(qualified.currentStreak, 1);
  assert.equal(qualified.stream.isLive && qualified.stream.qualified, true);
  const participation = (
    await harness.db
      .select()
      .from(userStreamParticipation)
      .where(eq(userStreamParticipation.userId, user.userId))
  )[0];
  assert.ok(participation?.qualifiedAt);

  await applyKickChatWebhook({
    externalEventId: "numeric-chat-11",
    messageId: "numeric-msg-11",
    senderUserId,
  });
  const afterEleventh = await readStreamStreakState(harness.db, user.userId);
  assert.equal(afterEleventh.currentStreak, 1);
  assert.equal(afterEleventh.stream.isLive && afterEleventh.stream.messages, 11);

  await applyKickChatWebhook({
    externalEventId: "numeric-chat-10-dup",
    messageId: "numeric-msg-10",
    senderUserId,
  });
  const afterDup = await readStreamStreakState(harness.db, user.userId);
  assert.equal(afterDup.currentStreak, 1);
  assert.equal(afterDup.stream.isLive && afterDup.stream.messages, 11);
  const afterDupApps = await harness.db
    .select()
    .from(kickChatMessageApplications)
    .where(eq(kickChatMessageApplications.userId, user.userId));
  assert.equal(afterDupApps.length, 11);
});

test("concurrent 9→11 messages qualify streak once", async () => {
  const { userId, kickUserId } = await setupLinkedUser("conc-1");
  await freshStream("stream-conc-1");
  await sendMessages(kickUserId, 9, "conc-pre");
  const [a, b] = await Promise.all([
    applyKickChatMessage(harness.db, {
      providerMessageId: "conc-a",
      kickUserId,
      channel: KICK_TARGET_CHANNEL,
    }),
    applyKickChatMessage(harness.db, {
      providerMessageId: "conc-b",
      kickUserId,
      channel: KICK_TARGET_CHANNEL,
    }),
  ]);
  assert.equal(a.applied && b.applied, true);
  const streak = await readStreamStreakState(harness.db, userId);
  assert.equal(streak.currentStreak, 1);
  assert.equal(await walletBalance(userId), 100n);
  const rewards = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, userId));
  assert.equal(
    rewards.filter((row) => row.type === "stream_streak_reward").length,
    1,
  );
  const part = (
    await harness.db
      .select()
      .from(userStreamParticipation)
      .where(eq(userStreamParticipation.userId, userId))
  ).find((row) => row.messageCount >= 11);
  assert.ok(part);
  assert.equal(part.messageCount, 11);
});

test("level boundary concurrent grants once", async () => {
  const { userId, kickUserId } = await setupLinkedUser("lvl-conc");
  await setTotalXp(userId, 199n);
  await freshStream("stream-lvl-conc");
  await Promise.all([
    applyKickChatMessage(harness.db, {
      providerMessageId: "lvl-a",
      kickUserId,
      channel: KICK_TARGET_CHANNEL,
    }),
    applyKickChatMessage(harness.db, {
      providerMessageId: "lvl-b",
      kickUserId,
      channel: KICK_TARGET_CHANNEL,
    }),
  ]);
  const progress = (
    await harness.db
      .select()
      .from(userProgress)
      .where(eq(userProgress.userId, userId))
  )[0];
  assert.equal(String(progress?.totalXp), "201");
  const grants = await harness.db
    .select()
    .from(userLevelRewards)
    .where(eq(userLevelRewards.userId, userId));
  assert.equal(grants.length, 1);
  assert.equal(grants[0]?.reachedLevel, 2);
  assert.equal(String(grants[0]?.rewardAzc), "100");
  const tgJobs = await harness.db
    .select()
    .from(jobs)
    .where(eq(jobs.idempotencyKey, `level.reward.notify:${userId}:2`));
  assert.ok(tgJobs.length <= 1);
});

test("zero-message stream finalizer resets active streak without participation row", async () => {
  const { userId } = await setupLinkedUser("zero-part");
  await setStreak(userId, 4);
  await freshStream("zero-part");
  // No chat messages / participation rows before finalize.
  await endAndFinalize("zero-part");
  assert.equal((await readStreamStreakState(harness.db, userId)).currentStreak, 0);
});

test("missed stream reset / freeze / qualified paths", async () => {
  {
    const { userId } = await setupLinkedUser("miss-a");
    await setStreak(userId, 4);
    await freshStream("miss-a");
    await endAndFinalize("miss-a");
    assert.equal((await readStreamStreakState(harness.db, userId)).currentStreak, 0);
  }

  {
    const { userId, kickUserId } = await setupLinkedUser("miss-b");
    await setStreak(userId, 4);
    await freshStream("miss-b");
    await sendMessages(kickUserId, 9, "miss-b");
    await endAndFinalize("miss-b");
    assert.equal((await readStreamStreakState(harness.db, userId)).currentStreak, 0);
  }

  {
    const { userId } = await setupLinkedUser("miss-c");
    await setStreak(userId, 4);
    await grantFreeze(userId, 1);
    await freshStream("miss-c");
    await endAndFinalize("miss-c");
    const state = await readStreamStreakState(harness.db, userId);
    assert.equal(state.currentStreak, 4);
    assert.equal(state.freezeCount, 0);
  }

  {
    const { userId, kickUserId } = await setupLinkedUser("miss-d");
    await setStreak(userId, 4);
    await grantFreeze(userId, 1);
    await freshStream("miss-d");
    await sendMessages(kickUserId, 9, "miss-d");
    await endAndFinalize("miss-d");
    assert.equal((await readStreamStreakState(harness.db, userId)).currentStreak, 4);
  }

  {
    const { userId, kickUserId } = await setupLinkedUser("miss-e");
    await setStreak(userId, 4);
    await grantFreeze(userId, 1);
    await freshStream("miss-e");
    await sendMessages(kickUserId, 10, "miss-e");
    const mid = await readStreamStreakState(harness.db, userId);
    assert.equal(mid.currentStreak, 5);
    await endAndFinalize("miss-e");
    const after = await readStreamStreakState(harness.db, userId);
    assert.equal(after.currentStreak, 5);
    assert.equal(after.freezeCount, 1);
    assert.equal(await walletBalance(userId), 500n);
  }

  {
    const { userId } = await setupLinkedUser("miss-f");
    await setStreak(userId, 10);
    await freshStream("miss-f");
    await endAndFinalize("miss-f");
    assert.equal((await readStreamStreakState(harness.db, userId)).currentStreak, 10);
  }
});

test("duplicate live/offline and finalize are safe", async () => {
  await endAndFinalize();
  const first = await startKickStreamSession(harness.db, {
    providerStreamId: "dup-stream-1",
  });
  const second = await startKickStreamSession(harness.db, {
    providerStreamId: "dup-stream-1",
  });
  assert.equal(first.sessionId, second.sessionId);
  assert.equal(second.created, false);
  const ended1 = await endKickStreamSession(harness.db, {
    providerStreamId: "dup-stream-1",
  });
  const ended2 = await endKickStreamSession(harness.db, {
    providerStreamId: "dup-stream-1",
  });
  assert.equal(ended1.ended, true);
  assert.equal(ended2.ended, false);
  assert.ok(ended1.sessionId);
  const f1 = await finalizeKickStreamSession(harness.db, ended1.sessionId);
  const f2 = await finalizeKickStreamSession(harness.db, ended1.sessionId);
  assert.equal(f1.done, true);
  assert.equal(f2.done, true);
});

test("level multi-cross grants each reward once", async () => {
  const { userId } = await setupLinkedUser("multi-lvl");
  const granted = await grantLevelRewards(harness.db, {
    userId,
    previousLevel: 8,
    newLevel: 11,
  });
  assert.deepEqual(
    granted.map((g) => g.reachedLevel),
    [9, 10, 11],
  );
  const replay = await grantLevelRewards(harness.db, {
    userId,
    previousLevel: 8,
    newLevel: 11,
  });
  assert.equal(replay.length, 0);
  const rows = await harness.db
    .select()
    .from(userLevelRewards)
    .where(eq(userLevelRewards.userId, userId));
  assert.equal(rows.length, 3);
  assert.equal(rewardForReachedLevel(9), 2000n);
  assert.equal(rewardForReachedLevel(10), 5000n);
  assert.equal(rewardForReachedLevel(11), 3000n);
});

test("wallet invariant after streak+level path", async () => {
  const { userId, kickUserId } = await setupLinkedUser("inv-1");
  await freshStream("inv-stream");
  await sendMessages(kickUserId, 10, "inv");
  const balance = await walletBalance(userId);
  const sum = await ledgerSum(userId);
  assert.equal(balance, sum);
  assert.equal(balance, 100n);
});

test("tenth message can award streak and level together", async () => {
  const { userId, kickUserId } = await setupLinkedUser("combo");
  await setTotalXp(userId, 190n);
  await freshStream("combo-stream");
  await sendMessages(kickUserId, 9, "combo-pre");
  const tenth = await applyKickChatMessage(harness.db, {
    providerMessageId: "combo-10",
    kickUserId,
    channel: KICK_TARGET_CHANNEL,
  });
  assert.equal(tenth.streak, 1);
  assert.ok(tenth.levelGrants?.some((g) => g.reachedLevel === 2));
  assert.equal(await walletBalance(userId), 200n);
});
