import { jobs } from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { claimNextJob, failJob } from "./claim.js";
import { enqueueJob } from "./enqueue.js";
import type { JobsHarness } from "./harness.js";
import { startJobsHarness } from "./harness.js";
import { persistInboundAndEnqueue } from "./ingress.js";
import { computeBackoffMs, JOB_RETRY } from "./retry.js";
import { JOB_TYPES } from "./types.js";

let harness: JobsHarness;

before(async () => {
  harness = await startJobsHarness({ port: 55439 });
});

after(async () => {
  await harness.stop();
});

test("backoff is exponential with bounded jitter", () => {
  assert.equal(computeBackoffMs(0, () => 0), JOB_RETRY.baseDelayMs);
  assert.equal(
    computeBackoffMs(0, () => 1),
    JOB_RETRY.baseDelayMs + Math.floor(JOB_RETRY.baseDelayMs * JOB_RETRY.jitterRatio),
  );
  assert.equal(computeBackoffMs(3, () => 0), JOB_RETRY.baseDelayMs * 8);
  assert.ok(computeBackoffMs(20, () => 0) <= JOB_RETRY.maxDelayMs);
});

test("failJob retries as pending with next_attempt_at and then dies", async () => {
  const enqueued = await enqueueJob(harness.db, {
    type: JOB_TYPES.walletReconcile,
    idempotencyKey: "retry:fail-then-dead",
    payload: { user_id: "00000000-0000-0000-0000-000000000001" },
  });
  await harness.db
    .update(jobs)
    .set({
      status: "processing",
      lockedAt: new Date(),
      lockedBy: "retry-fail-1",
    })
    .where(eq(jobs.id, enqueued.jobId));

  const before = Date.now();
  await failJob(harness.db, enqueued.jobId, "boom", 0, 2);
  const afterFail = (
    await harness.db.select().from(jobs).where(eq(jobs.id, enqueued.jobId))
  )[0];
  assert.equal(afterFail?.status, "pending");
  assert.equal(afterFail?.retryCount, 1);
  assert.ok(
    (afterFail?.nextAttemptAt.getTime() ?? 0) >=
      before + JOB_RETRY.baseDelayMs - 50,
  );

  const tooSoon = await claimNextJob(harness.db, {
    owner: "worker",
    lockedBy: "retry-fail-2",
  });
  assert.notEqual(tooSoon?.id, enqueued.jobId);

  await harness.db
    .update(jobs)
    .set({ nextAttemptAt: new Date(Date.now() - 1) })
    .where(eq(jobs.id, enqueued.jobId));
  let retryId: string | undefined;
  for (let i = 0; i < 16; i += 1) {
    const retry = await claimNextJob(harness.db, {
      owner: "worker",
      lockedBy: "retry-fail-3",
    });
    if (!retry) {
      break;
    }
    if (retry.id === enqueued.jobId) {
      retryId = retry.id;
      break;
    }
  }
  assert.equal(retryId, enqueued.jobId);
  await failJob(harness.db, enqueued.jobId, "boom again", 1, 2);
  const dead = (
    await harness.db.select().from(jobs).where(eq(jobs.id, enqueued.jobId))
  )[0];
  assert.equal(dead?.status, "dead");
  assert.equal(dead?.retryCount, 2);
});

test("stale processing locks are reclaimed only by the same owner", async () => {
  const bot = await persistInboundAndEnqueue(harness.db, {
    provider: "telegram",
    eventType: "message",
    externalEventId: "29001",
    payload: { update_id: 29001 },
  });
  const worker = await enqueueJob(harness.db, {
    type: JOB_TYPES.walletReconcile,
    idempotencyKey: "retry:stale-worker",
    payload: {},
  });

  await harness.db
    .update(jobs)
    .set({
      status: "processing",
      lockedAt: new Date(Date.now() - 120_000),
      lockedBy: "dead-bot",
    })
    .where(eq(jobs.id, bot.jobId));
  await harness.db
    .update(jobs)
    .set({
      status: "processing",
      lockedAt: new Date(Date.now() - 120_000),
      lockedBy: "dead-worker",
    })
    .where(eq(jobs.id, worker.jobId));

  let stolenId: string | undefined;
  for (let i = 0; i < 16; i += 1) {
    const stolen = await claimNextJob(harness.db, {
      owner: "worker",
      lockedBy: "alive-worker",
      staleLockMs: 60_000,
    });
    if (!stolen) {
      break;
    }
    assert.notEqual(stolen.id, bot.jobId);
    assert.equal(stolen.owner, "worker");
    if (stolen.id === worker.jobId) {
      stolenId = stolen.id;
      break;
    }
  }
  assert.equal(stolenId, worker.jobId);

  const botStill = (
    await harness.db.select().from(jobs).where(eq(jobs.id, bot.jobId))
  )[0];
  assert.equal(botStill?.status, "processing");
  assert.equal(botStill?.lockedBy, "dead-bot");

  const fresh = await enqueueJob(harness.db, {
    type: JOB_TYPES.walletReconcile,
    idempotencyKey: "retry:fresh-lock",
    payload: {},
  });
  await harness.db
    .update(jobs)
    .set({
      status: "processing",
      lockedAt: new Date(),
      lockedBy: "fresh-worker",
    })
    .where(eq(jobs.id, fresh.jobId));
  const notStolen = await claimNextJob(harness.db, {
    owner: "worker",
    lockedBy: "other-worker",
    staleLockMs: 60_000,
  });
  assert.notEqual(notStolen?.id, fresh.jobId);
});

test("higher priority bot jobs are claimed before older broadcast jobs", async () => {
  const low = await enqueueJob(harness.db, {
    type: JOB_TYPES.telegramSendMessage,
    idempotencyKey: "priority:broadcast-old",
    payload: { chat_id: 1, text: "low" },
    priority: -10,
  });
  const high = await enqueueJob(harness.db, {
    type: JOB_TYPES.telegramSendMessage,
    idempotencyKey: "priority:start-new",
    payload: { chat_id: 2, text: "high" },
    priority: 0,
  });
  let seenHigh = false;
  for (let i = 0; i < 32; i += 1) {
    const claimed = await claimNextJob(harness.db, {
      owner: "bot",
      lockedBy: "priority-bot",
    });
    if (!claimed) {
      break;
    }
    assert.notEqual(claimed.id, low.jobId);
    if (claimed.id === high.jobId) {
      seenHigh = true;
      break;
    }
  }
  assert.equal(seenHigh, true);
});

