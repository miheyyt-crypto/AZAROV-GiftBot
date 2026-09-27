import { jobs, telegramAccounts, telegramBroadcasts, users } from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  createAndEnqueueTelegramBroadcast,
  listBroadcastTelegramRecipients,
  recordBroadcastJobOutcome,
} from "./broadcast.js";
import { TELEGRAM_CAPTION_MAX_LENGTH } from "./telegram-html.js";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import { identifyTelegramUser } from "./telegram-identity.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

test("text-only broadcast enqueues send_message jobs for active telegram users", async () => {
  const a = await identifyTelegramUser(harness.db, {
    telegramUserId: 880001n,
    firstName: "A",
  });
  const b = await identifyTelegramUser(harness.db, {
    telegramUserId: 880002n,
    firstName: "B",
  });
  const inactive = await identifyTelegramUser(harness.db, {
    telegramUserId: 880003n,
    firstName: "C",
  });
  await harness.db
    .update(telegramAccounts)
    .set({ isActive: false })
    .where(eq(telegramAccounts.telegramUserId, 880003n));
  await harness.db
    .update(users)
    .set({ status: "deleted", deletedAt: new Date() })
    .where(eq(users.id, inactive.userId));

  const recipients = await listBroadcastTelegramRecipients(harness.db);
  assert.equal(recipients.some((row) => row.telegramUserId === 880003n), false);

  const created = await createAndEnqueueTelegramBroadcast(harness.db, {
    adminUserId: a.userId,
    messageText: "Hello <b>world</b>",
  });
  assert.equal(created.status, "sending");
  const messageJobs = await harness.db
    .select()
    .from(jobs)
    .where(eq(jobs.type, "telegram.send_message"));
  const mine = messageJobs.filter((job) =>
    String(job.idempotencyKey).startsWith(`telegram:broadcast:${created.id}:`),
  );
  assert.ok(mine.length >= 2);
  assert.equal(
    mine.some((job) => job.idempotencyKey.endsWith(":880003")),
    false,
  );
  assert.equal(mine[0]?.owner, "bot");
  assert.equal(mine[0]?.priority, -10);
  const payload = mine[0]?.payload as { parse_mode?: string; text?: string };
  assert.equal(payload.parse_mode, "HTML");
  assert.match(payload.text ?? "", /<b>world<\/b>/);

  const replayJobs = await createAndEnqueueTelegramBroadcast(harness.db, {
    adminUserId: a.userId,
    messageText: "Hello <b>world</b>",
  });
  const again = (
    await harness.db.select().from(jobs).where(eq(jobs.type, "telegram.send_message"))
  ).filter((job) =>
    String(job.idempotencyKey).startsWith(`telegram:broadcast:${created.id}:`),
  );
  assert.equal(again.length, mine.length);
  assert.notEqual(replayJobs.id, created.id);
  void b;
});

test("photo broadcast uses send_photo; long text splits into photo then message", async () => {
  const user = await identifyTelegramUser(harness.db, {
    telegramUserId: 880010n,
    firstName: "Photo",
  });
  const short = await createAndEnqueueTelegramBroadcast(harness.db, {
    adminUserId: user.userId,
    messageText: "cap",
    photoKey: "broadcasts/11111111-1111-4111-8111-111111111111.jpg",
  });
  const photoJobs = (
    await harness.db.select().from(jobs).where(eq(jobs.type, "telegram.send_photo"))
  ).filter((job) =>
    String(job.idempotencyKey).startsWith(`telegram:broadcast:${short.id}:`),
  );
  assert.equal(photoJobs.length, short.recipientCount);
  assert.ok(
    photoJobs.some((job) => job.idempotencyKey === `telegram:broadcast:${short.id}:880010`),
  );

  const longText = "z".repeat(TELEGRAM_CAPTION_MAX_LENGTH + 8);
  const split = await createAndEnqueueTelegramBroadcast(harness.db, {
    adminUserId: user.userId,
    messageText: longText,
    photoKey: "broadcasts/22222222-2222-4222-8222-222222222222.png",
  });
  const splitPhoto = (
    await harness.db.select().from(jobs).where(eq(jobs.type, "telegram.send_photo"))
  ).filter((job) =>
    String(job.idempotencyKey).startsWith(`telegram:broadcast:${split.id}:`),
  );
  const splitText = (
    await harness.db.select().from(jobs).where(eq(jobs.type, "telegram.send_message"))
  ).filter((job) =>
    String(job.idempotencyKey).startsWith(`telegram:broadcast:${split.id}:`),
  );
  assert.equal(splitPhoto.length, split.recipientCount);
  assert.equal(splitText.length, split.recipientCount);
  assert.ok(splitPhoto.every((job) => job.idempotencyKey.endsWith(":photo")));
  assert.ok(splitText.every((job) => job.idempotencyKey.endsWith(":text")));
  const ownPhoto = splitPhoto.find((job) => job.idempotencyKey.includes(":880010:"));
  const ownText = splitText.find((job) => job.idempotencyKey.includes(":880010:"));
  assert.equal((ownPhoto?.payload as { caption?: string }).caption, undefined);
  assert.equal(((ownText?.payload as { text?: string }).text ?? "").length, longText.length);
});

test("100 recipients enqueue 100 jobs and one failure does not drop counters for others", async () => {
  const admin = await identifyTelegramUser(harness.db, {
    telegramUserId: 881000n,
    firstName: "Admin",
  });
  for (let i = 0; i < 100; i += 1) {
    await identifyTelegramUser(harness.db, {
      telegramUserId: BigInt(882000 + i),
      firstName: `U${i}`,
    });
  }
  const created = await createAndEnqueueTelegramBroadcast(harness.db, {
    adminUserId: admin.userId,
    messageText: "blast",
  });
  const mine = (
    await harness.db.select().from(jobs).where(eq(jobs.type, "telegram.send_message"))
  ).filter((job) =>
    String(job.idempotencyKey).startsWith(`telegram:broadcast:${created.id}:`),
  );
  assert.ok(mine.length >= 100);

  const firstTg = BigInt(
    String(mine[0]?.idempotencyKey).split(":").pop() ?? "0",
  );
  await recordBroadcastJobOutcome(harness.db, {
    broadcastId: created.id,
    telegramUserId: firstTg,
    failed: true,
    error: "forbidden",
  });
  await recordBroadcastJobOutcome(harness.db, {
    broadcastId: created.id,
    telegramUserId: firstTg,
    failed: true,
    error: "forbidden",
  });
  const secondTg = BigInt(
    String(mine[1]?.idempotencyKey).split(":").pop() ?? "0",
  );
  await recordBroadcastJobOutcome(harness.db, {
    broadcastId: created.id,
    telegramUserId: secondTg,
    failed: false,
  });
  const rows = await harness.db
    .select()
    .from(telegramBroadcasts)
    .where(eq(telegramBroadcasts.id, created.id));
  assert.equal(rows[0]?.failedCount, 1);
  assert.equal(rows[0]?.sentCount, 1);
});
