import {
  inboundEvents,
  jobs,
  telegramAccounts,
  users,
} from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import { applyKickInboundEvent } from "./kick.js";
import {
  KICK_STREAM_WATCH_URL,
  STREAM_START_NOTICE_HTML,
  STREAM_START_NOTICE_TEXT,
  STREAM_START_TASKS_BUTTON_TEXT,
  STREAM_START_WATCH_BUTTON_TEXT,
  resolveTasksWebAppUrl,
  streamStartJobIdempotencyKey,
  streamStartReplyMarkup,
} from "./stream-start-notice.js";
import { identifyTelegramUser } from "./telegram-identity.js";
import { provisionUser } from "./user.js";

test("stream start copy keeps Kick URL and preview-friendly keyboard", () => {
  assert.equal(
    STREAM_START_NOTICE_TEXT,
    [
      "🔴 Стрим начался!",
      "",
      "Самое время заглянуть и выполнить ежедневные задания",
      "🔥 Заходи на стрим и начни свой стрик!",
      "",
      "👉 Смотреть на Kick",
      "",
      "https://kick.com/azarov7777",
    ].join("\n"),
  );
  assert.match(STREAM_START_NOTICE_HTML, /<b>Стрим начался!<\/b>/);
  assert.match(STREAM_START_NOTICE_HTML, /https:\/\/kick\.com\/azarov7777/);
  assert.equal(
    resolveTasksWebAppUrl("https://azarovgift.xyz/"),
    "https://azarovgift.xyz/tasks",
  );
  assert.deepEqual(streamStartReplyMarkup("https://azarovgift.xyz"), {
    inline_keyboard: [
      [
        {
          text: STREAM_START_WATCH_BUTTON_TEXT,
          url: KICK_STREAM_WATCH_URL,
        },
      ],
      [
        {
          text: STREAM_START_TASKS_BUTTON_TEXT,
          web_app: { url: "https://azarovgift.xyz/tasks" },
        },
      ],
    ],
  });
});

let harness: DomainHarness;
let telegramSeq = 9910000n;

before(async () => {
  process.env.PUBLIC_BASE_URL = "https://azarovgift.xyz";
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

async function nextTelegramId(): Promise<bigint> {
  telegramSeq += 1n;
  return telegramSeq;
}

async function linkActiveTelegram(label: string): Promise<{
  userId: string;
  telegramUserId: bigint;
}> {
  const identified = await identifyTelegramUser(harness.db, {
    telegramUserId: await nextTelegramId(),
    firstName: label,
  });
  return {
    userId: identified.userId,
    telegramUserId: (await harness.db
      .select({ id: telegramAccounts.telegramUserId })
      .from(telegramAccounts)
      .where(eq(telegramAccounts.userId, identified.userId)))[0]!.id,
  };
}

async function applyLivestream(input: {
  externalEventId: string;
  isLive: boolean;
  livestreamId?: string | number;
}): Promise<Awaited<ReturnType<typeof applyKickInboundEvent>>> {
  const inserted = await harness.db
    .insert(inboundEvents)
    .values({
      provider: "kick",
      eventType: "livestream.status.updated",
      externalEventId: input.externalEventId,
      idempotencyKey: `kick:${input.externalEventId}`,
      payload: {
        broadcaster: {
          username: "azarov7777",
          channel_slug: "azarov7777",
        },
        is_live: input.isLive,
        ...(input.livestreamId !== undefined
          ? { livestream_id: input.livestreamId }
          : {}),
      },
      signatureValid: true,
    })
    .returning({ id: inboundEvents.id });
  const eventId = inserted[0]?.id;
  assert.ok(eventId);
  return applyKickInboundEvent(harness.db, eventId);
}

function noticeJobsFor(sessionId: string) {
  return harness.db
    .select()
    .from(jobs)
    .where(eq(jobs.type, "telegram.send_message"))
    .then((rows) =>
      rows.filter((row) =>
        row.idempotencyKey.startsWith(`kick:stream-start:${sessionId}:`),
      ),
    );
}

test("offline to live fans out once; live to live and offline do not", async () => {
  const active = await linkActiveTelegram("stream-active");
  const extra = await linkActiveTelegram("stream-extra");
  const inactiveTelegramId = await nextTelegramId();
  const inactiveUser = await identifyTelegramUser(harness.db, {
    telegramUserId: inactiveTelegramId,
    firstName: "inactive",
  });
  await harness.db
    .update(telegramAccounts)
    .set({ isActive: false })
    .where(eq(telegramAccounts.userId, inactiveUser.userId));
  const blocked = await provisionUser(harness.db);
  const blockedTelegramId = await nextTelegramId();
  await harness.db.insert(telegramAccounts).values({
    userId: blocked.userId,
    telegramUserId: blockedTelegramId,
    firstName: "blocked",
  });
  await harness.db
    .update(users)
    .set({ status: "blocked" })
    .where(eq(users.id, blocked.userId));

  const first = await applyLivestream({
    externalEventId: "kick-live-1",
    isLive: true,
    livestreamId: "stream-session-a",
  });
  assert.equal(first.replayed, false);
  assert.equal(first.livestream?.transition, "offline_to_live");
  assert.ok(first.livestream?.sessionId);
  const sessionA = first.livestream.sessionId;
  const jobsA = await noticeJobsFor(sessionA);
  const chatIds = jobsA.map((row) => {
    const payload = row.payload as Record<string, unknown>;
    return payload.chat_id;
  });
  assert.ok(chatIds.includes(Number(active.telegramUserId)));
  assert.ok(chatIds.includes(Number(extra.telegramUserId)));
  assert.equal(chatIds.includes(Number(blockedTelegramId)), false);
  assert.equal(chatIds.includes(Number(inactiveTelegramId)), false);
  for (const row of jobsA) {
    const payload = row.payload as Record<string, unknown>;
    assert.equal(payload.text, STREAM_START_NOTICE_HTML);
    assert.equal(payload.parse_mode, "HTML");
    assert.equal(payload.disable_web_page_preview, false);
    assert.deepEqual(payload.reply_markup, streamStartReplyMarkup());
    assert.equal(row.owner, "bot");
  }

  const liveAgain = await applyLivestream({
    externalEventId: "kick-live-1b",
    isLive: true,
    livestreamId: "stream-session-a",
  });
  assert.equal(liveAgain.livestream?.transition, "live_to_live");
  assert.equal((await noticeJobsFor(sessionA)).length, jobsA.length);

  const duplicateInbound = await applyKickInboundEvent(
    harness.db,
    (
      await harness.db
        .select({ id: inboundEvents.id })
        .from(inboundEvents)
        .where(eq(inboundEvents.externalEventId, "kick-live-1"))
    )[0]!.id,
  );
  assert.equal(duplicateInbound.replayed, true);
  assert.equal((await noticeJobsFor(sessionA)).length, jobsA.length);

  const offline = await applyLivestream({
    externalEventId: "kick-offline-1",
    isLive: false,
    livestreamId: "stream-session-a",
  });
  assert.equal(offline.livestream?.transition, "live_to_offline");
  assert.equal((await noticeJobsFor(sessionA)).length, jobsA.length);

  const second = await applyLivestream({
    externalEventId: "kick-live-2",
    isLive: true,
    livestreamId: "stream-session-b",
  });
  assert.equal(second.livestream?.transition, "offline_to_live");
  const sessionB = second.livestream?.sessionId;
  assert.ok(sessionB);
  assert.notEqual(sessionB, sessionA);
  const jobsB = await noticeJobsFor(sessionB);
  assert.equal(jobsB.length, jobsA.length);
  assert.ok(
    jobsB.some(
      (row) =>
        row.idempotencyKey ===
        streamStartJobIdempotencyKey(sessionB, active.telegramUserId),
    ),
  );
});
