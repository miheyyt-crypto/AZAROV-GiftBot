import {
  inboundEvents,
  jobs,
  referrals,
  adminRoleAssignments,
  adminRoles,
  telegramAccounts,
  users,
  walletTransactions,
  wallets,
} from "@giftbot/db/schema";
import {
  createLocalSubmissionFileStorage,
  createAndEnqueueTelegramBroadcast,
  encodeWelvuraAdminCallback,
  provisionUser,
  STREAM_START_NOTICE_HTML,
  formatMiniAppOnlineMessage,
  identifyTelegramUser,
  streamStartReplyMarkup,
  submitWelvuraAccount,
} from "@giftbot/domain";
import {
  claimNextJob,
  enqueueJob,
  JOB_TYPES,
  persistInboundAndEnqueue,
  type ClaimedJob,
} from "@giftbot/jobs";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { close, createBotHealthServer, listen } from "./health.js";
import type { BotHarness } from "./harness.js";
import { startBotHarness } from "./harness.js";
import { processBotJob } from "./process-job.js";
import type {
  TelegramInlineKeyboardMarkup,
  TelegramMessageSendOptions,
  TelegramPhotoSend,
  TelegramSender,
} from "./sender.js";
import { TelegramPermanentSendError } from "./telegram-errors.js";
import {
  START_LAUNCH_BUTTON_TEXT,
  START_WELCOME_CAPTION,
} from "./start-welcome.js";

let harness: BotHarness;

before(async () => {
  process.env.PUBLIC_BASE_URL = "https://azarovgift.xyz";
  harness = await startBotHarness();
});

after(async () => {
  await harness.stop();
});

function asClaimed(row: typeof jobs.$inferSelect): ClaimedJob {
  return {
    id: row.id,
    type: row.type,
    owner: row.owner,
    payload: row.payload,
    idempotencyKey: row.idempotencyKey,
    inboundEventId: row.inboundEventId,
    correlationId: row.correlationId,
    retryCount: row.retryCount,
    maxAttempts: row.maxAttempts,
  };
}

function recordingSender(): TelegramSender & {
  sent: {
    chatId: number | string;
    text: string;
    options?: TelegramMessageSendOptions;
  }[];
  photos: { chatId: number | string; photo: TelegramPhotoSend }[];
  answers: { callbackQueryId: string; text?: string }[];
  edits: {
    chatId: number | string;
    messageId: number;
    caption: string;
    replyMarkup?: TelegramInlineKeyboardMarkup;
  }[];
} {
  const sent: {
    chatId: number | string;
    text: string;
    options?: TelegramMessageSendOptions;
  }[] = [];
  const photos: { chatId: number | string; photo: TelegramPhotoSend }[] = [];
  const answers: { callbackQueryId: string; text?: string }[] = [];
  const edits: {
    chatId: number | string;
    messageId: number;
    caption: string;
    replyMarkup?: TelegramInlineKeyboardMarkup;
  }[] = [];
  return {
    sent,
    photos,
    answers,
    edits,
    async sendMessage(chatId, text, options) {
      sent.push({
        chatId,
        text,
        ...(options ? { options } : {}),
      });
    },
    async sendPhoto(chatId, photo) {
      photos.push({ chatId, photo });
    },
    async answerCallbackQuery(callbackQueryId, text) {
      answers.push({
        callbackQueryId,
        ...(text ? { text } : {}),
      });
    },
    async editMessageCaption(chatId, messageId, caption, replyMarkup) {
      edits.push({
        chatId,
        messageId,
        caption,
        ...(replyMarkup ? { replyMarkup } : {}),
      });
    },
  };
}

async function loadJob(jobId: string): Promise<ClaimedJob> {
  const rows = await harness.db.select().from(jobs).where(eq(jobs.id, jobId));
  const row = rows[0];
  assert.ok(row);
  return asClaimed(row);
}

test("GET /health/live does not claim bot jobs", async () => {
  const persisted = await persistInboundAndEnqueue(harness.db, {
    provider: "telegram",
    eventType: "message",
    externalEventId: "80001",
    payload: {
      update_id: 80001,
      message: {
        chat: { id: 80001 },
        text: "ping",
        from: { id: 880001, first_name: "Health" },
      },
    },
  });
  const server = createBotHealthServer();
  await listen(server, "127.0.0.1", 0);
  const address = server.address() as AddressInfo;
  try {
    await new Promise<void>((resolve, reject) => {
      request(
        { host: "127.0.0.1", port: address.port, path: "/health/live" },
        (res) => {
          res.resume();
          res.on("end", () => {
            if (res.statusCode === 200) {
              resolve();
              return;
            }
            reject(new Error(`health status ${res.statusCode}`));
          });
        },
      )
        .on("error", reject)
        .end();
    });
  } finally {
    await close(server);
  }
  const row = (await harness.db.select().from(jobs).where(eq(jobs.id, persisted.jobId)))[0];
  assert.equal(row?.status, "pending");
});

test("/start identifies the user, attributes a referral once, and acks once", async () => {
  const referrer = await provisionUser(harness.db);
  const sender = recordingSender();
  const update = {
    update_id: 80002,
    message: {
      chat: { id: 4242 },
      text: `/start ${referrer.referralCode}`,
      from: { id: 880002, first_name: "Referee", username: "ref" },
    },
  };
  const first = await persistInboundAndEnqueue(harness.db, {
    provider: "telegram",
    eventType: "message",
    externalEventId: "80002",
    payload: update,
  });
  await processBotJob(harness.db, await loadJob(first.jobId), sender);

  const account = (
    await harness.db
      .select()
      .from(telegramAccounts)
      .where(eq(telegramAccounts.telegramUserId, 880002n))
  )[0];
  assert.ok(account);
  const wallet = (
    await harness.db.select().from(wallets).where(eq(wallets.userId, account.userId))
  )[0];
  assert.ok(wallet);
  assert.equal(wallet.balanceMinor, 0n);
  const ledger = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.walletId, wallet.id));
  assert.equal(ledger.length, 0);

  const attributed = await harness.db
    .select()
    .from(referrals)
    .where(eq(referrals.refereeUserId, account.userId));
  assert.equal(attributed.length, 1);
  assert.equal(attributed[0]?.status, "attributed");
  assert.equal(attributed[0]?.referrerUserId, referrer.userId);

  const sendRows = await harness.db
    .select()
    .from(jobs)
    .where(eq(jobs.type, JOB_TYPES.telegramSendPhoto));
  const ack = sendRows.find(
    (row) => row.idempotencyKey === "telegram:80002:start_ack",
  );
  assert.ok(ack);
  assert.equal(ack.owner, "bot");
  const ackPayload = ack.payload as Record<string, unknown>;
  assert.equal(ackPayload.caption, START_WELCOME_CAPTION);
  assert.equal(ackPayload.mini_app_url, "https://azarovgift.xyz");
  await processBotJob(harness.db, asClaimed(ack), sender);
  assert.deepEqual(sender.sent, []);
  assert.equal(sender.photos.length, 1);
  assert.equal(sender.photos[0]?.chatId, 4242);
  assert.equal(sender.photos[0]?.photo.caption, START_WELCOME_CAPTION);
  assert.deepEqual(
    sender.photos[0]?.photo.replyMarkup?.inline_keyboard[0],
    [
      {
        text: START_LAUNCH_BUTTON_TEXT,
        web_app: { url: "https://azarovgift.xyz" },
      },
    ],
  );
  assert.match(
    (sender.photos[0]?.photo.photoPath ?? "").replaceAll("\\", "/"),
    /start-banner\.jpg$/,
  );

  const replayPersist = await persistInboundAndEnqueue(harness.db, {
    provider: "telegram",
    eventType: "message",
    externalEventId: "80002",
    payload: update,
  });
  assert.equal(replayPersist.jobId, first.jobId);
  await processBotJob(harness.db, await loadJob(first.jobId), sender);
  assert.equal(
    (
      await harness.db
        .select()
        .from(referrals)
        .where(eq(referrals.refereeUserId, account.userId))
    ).length,
    1,
  );
  const sendAfterReplay = await harness.db
    .select()
    .from(jobs)
    .where(eq(jobs.idempotencyKey, "telegram:80002:start_ack"));
  assert.equal(sendAfterReplay.length, 1);
  assert.equal(sender.photos.length, 1);
  assert.deepEqual(sender.sent, []);

  const inbound = (
    await harness.db
      .select()
      .from(inboundEvents)
      .where(eq(inboundEvents.externalEventId, "80002"))
  )[0];
  assert.equal(inbound?.processingStatus, "processed");
});

test("/start without payload sends welcome photo and WebApp button", async () => {
  const sender = recordingSender();
  const persisted = await persistInboundAndEnqueue(harness.db, {
    provider: "telegram",
    eventType: "message",
    externalEventId: "80005",
    payload: {
      update_id: 80005,
      message: {
        chat: { id: 9005 },
        text: "/start",
        from: { id: 880005, first_name: "Fresh" },
      },
    },
  });
  await processBotJob(harness.db, await loadJob(persisted.jobId), sender);
  const send = (
    await harness.db
      .select()
      .from(jobs)
      .where(eq(jobs.idempotencyKey, "telegram:80005:start_ack"))
  )[0];
  assert.ok(send);
  assert.equal(send.type, JOB_TYPES.telegramSendPhoto);
  const payload = send.payload as Record<string, unknown>;
  assert.equal(payload.caption, START_WELCOME_CAPTION);
  assert.equal(payload.mini_app_url, "https://azarovgift.xyz");
  await processBotJob(harness.db, asClaimed(send), sender);
  assert.equal(sender.photos.length, 1);
  assert.equal(sender.photos[0]?.photo.caption, START_WELCOME_CAPTION);
  assert.deepEqual(sender.photos[0]?.photo.replyMarkup?.inline_keyboard, [
    [
      {
        text: START_LAUNCH_BUTTON_TEXT,
        web_app: { url: "https://azarovgift.xyz" },
      },
    ],
  ]);
});

test("worker claim cannot take a bot send job", async () => {
  const sender = recordingSender();
  const persisted = await persistInboundAndEnqueue(harness.db, {
    provider: "telegram",
    eventType: "message",
    externalEventId: "80003",
    payload: {
      update_id: 80003,
      message: {
        chat: { id: 80003 },
        text: "/start",
        from: { id: 880003, first_name: "Solo" },
      },
    },
  });
  await processBotJob(harness.db, await loadJob(persisted.jobId), sender);
  const send = (
    await harness.db
      .select()
      .from(jobs)
      .where(eq(jobs.idempotencyKey, "telegram:80003:start_ack"))
  )[0];
  assert.ok(send);
  assert.equal(send.type, JOB_TYPES.telegramSendPhoto);

  for (let i = 0; i < 8; i += 1) {
    const claimed = await claimNextJob(harness.db, {
      owner: "worker",
      lockedBy: "worker-bot-test",
    });
    if (!claimed) {
      break;
    }
    assert.notEqual(claimed.id, send.id);
    assert.equal(claimed.owner, "worker");
  }

  const botClaim = await claimNextJob(harness.db, {
    owner: "bot",
    lockedBy: "bot-send-test",
  });
  assert.ok(botClaim);
  assert.equal(botClaim.owner, "bot");
});

test("a blocked user is marked processed without a send", async () => {
  const user = await provisionUser(harness.db);
  await harness.db.insert(telegramAccounts).values({
    userId: user.userId,
    telegramUserId: 880004n,
    firstName: "Blocked",
  });
  await harness.db
    .update(users)
    .set({ status: "blocked" })
    .where(eq(users.id, user.userId));

  const persisted = await persistInboundAndEnqueue(harness.db, {
    provider: "telegram",
    eventType: "message",
    externalEventId: "80004",
    payload: {
      update_id: 80004,
      message: {
        chat: { id: 80004 },
        text: "/start",
        from: { id: 880004, first_name: "Blocked" },
      },
    },
  });
  const sender = recordingSender();
  await processBotJob(harness.db, await loadJob(persisted.jobId), sender);
  const send = await harness.db
    .select()
    .from(jobs)
    .where(eq(jobs.idempotencyKey, "telegram:80004:start_ack"));
  assert.equal(send.length, 0);
  assert.deepEqual(sender.sent, []);
  const inbound = (
    await harness.db
      .select()
      .from(inboundEvents)
      .where(eq(inboundEvents.externalEventId, "80004"))
  )[0];
  assert.equal(inbound?.processingStatus, "processed");
});

test("stream start send_message keeps Kick URL preview and web_app tasks button", async () => {
  const sender = recordingSender();
  const markup = streamStartReplyMarkup("https://azarovgift.xyz");
  const enqueued = await enqueueJob(harness.db, {
    type: JOB_TYPES.telegramSendMessage,
    idempotencyKey: "kick:stream-start:test-session:880099",
    payload: {
      chat_id: 880099,
      text: STREAM_START_NOTICE_HTML,
      parse_mode: "HTML",
      reply_markup: markup,
      disable_web_page_preview: false,
    },
  });
  await processBotJob(harness.db, await loadJob(enqueued.jobId), sender);
  assert.equal(sender.sent.length, 1);
  assert.equal(sender.sent[0]?.text, STREAM_START_NOTICE_HTML);
  assert.match(String(sender.sent[0]?.text), /https:\/\/kick\.com\/azarov7777/);
  assert.equal(sender.sent[0]?.options?.parseMode, "HTML");
  assert.equal(sender.sent[0]?.options?.disableWebPagePreview, undefined);
  assert.deepEqual(sender.sent[0]?.options?.replyMarkup, markup);
  assert.deepEqual(markup.inline_keyboard, [
    [
      {
        text: "Зайти на стрим ↗",
        url: "https://kick.com/azarov7777",
      },
    ],
    [
      {
        text: "Выполнять задания ▣",
        web_app: { url: "https://azarovgift.xyz/tasks" },
      },
    ],
  ]);
});

async function assignSuperAdmin(userId: string): Promise<void> {
  const roles = await harness.db
    .select()
    .from(adminRoles)
    .where(eq(adminRoles.name, "super_admin"))
    .limit(1);
  assert.ok(roles[0]);
  await harness.db.insert(adminRoleAssignments).values({
    userId,
    roleId: roles[0].id,
  });
}

test("/admin replies with Mini App online only for assigned admins", async () => {
  const sender = recordingSender();
  const start = await persistInboundAndEnqueue(harness.db, {
    provider: "telegram",
    eventType: "message",
    externalEventId: "80100",
    payload: {
      update_id: 80100,
      message: {
        chat: { id: 80100 },
        text: "/start",
        from: { id: 880100, first_name: "AdminOnline" },
      },
    },
  });
  await processBotJob(harness.db, await loadJob(start.jobId), sender);
  const account = (
    await harness.db
      .select()
      .from(telegramAccounts)
      .where(eq(telegramAccounts.telegramUserId, 880100n))
  )[0];
  assert.ok(account);
  await assignSuperAdmin(account.userId);

  const adminCmd = await persistInboundAndEnqueue(harness.db, {
    provider: "telegram",
    eventType: "message",
    externalEventId: "80101",
    payload: {
      update_id: 80101,
      message: {
        chat: { id: 80100 },
        text: "/admin",
        from: { id: 880100, first_name: "AdminOnline" },
      },
    },
  });
  await processBotJob(harness.db, await loadJob(adminCmd.jobId), sender);
  const reply = (
    await harness.db
      .select()
      .from(jobs)
      .where(eq(jobs.idempotencyKey, "telegram:80101:admin_online"))
  )[0];
  assert.ok(reply);
  assert.equal(reply.type, JOB_TYPES.telegramSendMessage);
  const payload = reply.payload as { chat_id: number; text: string };
  assert.equal(payload.chat_id, 80100);
  assert.equal(payload.text, formatMiniAppOnlineMessage(0));
  await processBotJob(harness.db, asClaimed(reply), sender);
  assert.equal(sender.sent[0]?.text, formatMiniAppOnlineMessage(0));

  await processBotJob(harness.db, await loadJob(adminCmd.jobId), sender);
  const afterReplay = await harness.db
    .select()
    .from(jobs)
    .where(eq(jobs.idempotencyKey, "telegram:80101:admin_online"));
  assert.equal(afterReplay.length, 1);
});

test("/admin stays silent for users without an admin role", async () => {
  const sender = recordingSender();
  const persisted = await persistInboundAndEnqueue(harness.db, {
    provider: "telegram",
    eventType: "message",
    externalEventId: "80102",
    payload: {
      update_id: 80102,
      message: {
        chat: { id: 80102 },
        text: "/admin",
        from: { id: 880102, first_name: "Regular" },
      },
    },
  });
  await processBotJob(harness.db, await loadJob(persisted.jobId), sender);
  const reply = await harness.db
    .select()
    .from(jobs)
    .where(eq(jobs.idempotencyKey, "telegram:80102:admin_online"));
  assert.equal(reply.length, 0);
  assert.deepEqual(sender.sent, []);
  assert.deepEqual(sender.photos, []);
});

test("send_photo with storage_key sends the submission file, not the start banner", async () => {
  const root = await mkdtemp(join(tmpdir(), "giftbot-bot-upload-"));
  process.env.UPLOAD_DIR = root;
  const storageKey = "welvura/user-1/shot.png";
  await mkdir(join(root, "welvura", "user-1"), { recursive: true });
  await writeFile(join(root, storageKey), Buffer.from("png-bytes"));
  const sender = recordingSender();
  const enqueued = await enqueueJob(harness.db, {
    type: JOB_TYPES.telegramSendPhoto,
    idempotencyKey: "welvura:admin:account:photo-test:1",
    payload: {
      chat_id: 991100,
      caption: "🆕 НОВАЯ ЗАЯВКА WELVURA",
      storage_key: storageKey,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Применить", callback_data: "wvaa:00000000-0000-4000-8000-000000000001" },
            { text: "❌ Отклонить", callback_data: "wvar:00000000-0000-4000-8000-000000000001" },
          ],
        ],
      },
    },
  });
  await processBotJob(harness.db, await loadJob(enqueued.jobId), sender);
  assert.equal(sender.photos.length, 1);
  assert.equal(sender.photos[0]?.chatId, 991100);
  assert.equal(sender.photos[0]?.photo.caption, "🆕 НОВАЯ ЗАЯВКА WELVURA");
  assert.equal(sender.photos[0]?.photo.photoPath, resolve(root, storageKey));
  assert.deepEqual(sender.photos[0]?.photo.replyMarkup, {
    inline_keyboard: [
      [
        { text: "✅ Применить", callback_data: "wvaa:00000000-0000-4000-8000-000000000001" },
        { text: "❌ Отклонить", callback_data: "wvar:00000000-0000-4000-8000-000000000001" },
      ],
    ],
  });
});

test("welvura admin callback approve credits the submitter and clears buttons", async () => {
  const root = await mkdtemp(join(tmpdir(), "giftbot-bot-welvura-"));
  const storage = createLocalSubmissionFileStorage(root);
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
    "hex",
  );
  const submitter = await identifyTelegramUser(harness.db, {
    telegramUserId: 880210n,
    firstName: "Submitter",
    username: "wv_sub",
  });
  const admin = await identifyTelegramUser(harness.db, {
    telegramUserId: 880211n,
    firstName: "Moderator",
  });
  await assignSuperAdmin(admin.userId);
  const submitted = await submitWelvuraAccount(harness.db, storage, {
    userId: submitter.userId,
    welvuraId: "WIDBOT",
    contentType: "image/png",
    bytes: png,
  });
  const approveData = encodeWelvuraAdminCallback({
    kind: "account",
    action: "approve",
    submissionId: submitted.submissionId,
  });
  const sender = recordingSender();
  const persisted = await persistInboundAndEnqueue(harness.db, {
    provider: "telegram",
    eventType: "callback_query",
    externalEventId: "80210",
    payload: {
      update_id: 80210,
      callback_query: {
        id: "cbq-80210",
        data: approveData,
        from: { id: 880211, first_name: "Moderator" },
        message: {
          chat: { id: 880211 },
          message_id: 44,
          caption: "Статус: ⏳ Ожидает проверки",
        },
      },
    },
  });
  await processBotJob(harness.db, await loadJob(persisted.jobId), sender);
  const ack = (
    await harness.db
      .select()
      .from(jobs)
      .where(eq(jobs.idempotencyKey, "telegram:80210:cb_ack"))
  )[0];
  const edit = (
    await harness.db
      .select()
      .from(jobs)
      .where(eq(jobs.idempotencyKey, "telegram:80210:cb_edit"))
  )[0];
  assert.ok(ack);
  assert.ok(edit);
  assert.equal(ack.type, JOB_TYPES.telegramAnswerCallback);
  assert.equal(edit.type, JOB_TYPES.telegramEditMessage);
  await processBotJob(harness.db, asClaimed(ack), sender);
  await processBotJob(harness.db, asClaimed(edit), sender);
  assert.equal(sender.answers[0]?.text, "Заявка подтверждена");
  assert.match(sender.edits[0]?.caption ?? "", /Статус: ✅ Подтверждено/);
  assert.deepEqual(sender.edits[0]?.replyMarkup, { inline_keyboard: [] });
  const wallet = (
    await harness.db.select().from(wallets).where(eq(wallets.userId, submitter.userId))
  )[0];
  assert.equal(wallet?.balanceMinor, 1000n);
});

test("broadcast send_message records success; blocked user fails only that recipient", async () => {
  const one = await identifyTelegramUser(harness.db, {
    telegramUserId: 770501n,
    firstName: "One",
  });
  await identifyTelegramUser(harness.db, {
    telegramUserId: 770502n,
    firstName: "Two",
  });
  const created = await createAndEnqueueTelegramBroadcast(harness.db, {
    adminUserId: one.userId,
    messageText: "ping",
  });
  const rows = await harness.db
    .select()
    .from(jobs)
    .where(eq(jobs.type, JOB_TYPES.telegramSendMessage));
  const first = rows.find(
    (row) => row.idempotencyKey === `telegram:broadcast:${created.id}:770501`,
  );
  const second = rows.find(
    (row) => row.idempotencyKey === `telegram:broadcast:${created.id}:770502`,
  );
  assert.ok(first);
  assert.ok(second);
  const okSender = recordingSender();
  await processBotJob(harness.db, asClaimed(first), okSender);
  assert.equal(okSender.sent.length, 1);
  const blocked = recordingSender();
  blocked.sendMessage = async () => {
    throw new Error("Forbidden: bot was blocked by the user");
  };
  await assert.rejects(
    () => processBotJob(harness.db, asClaimed(second), blocked),
    TelegramPermanentSendError,
  );
});

