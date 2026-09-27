import { inboundEvents, jobs, walletTransactions, wallets } from "@giftbot/db/schema";
import { provisionUser } from "@giftbot/domain";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { JobsHarness } from "./harness.js";
import { startJobsHarness } from "./harness.js";
import {
  IdempotencyConflictError,
  runIdempotentPost,
} from "./http-idempotency.js";
import { claimNextJob } from "./claim.js";
import { persistInboundAndEnqueue } from "./ingress.js";
import { enqueueDueKickTokenRefreshes } from "./kick-refresh-sweep.js";
import { enqueueReconcileSweep } from "./reconcile-sweep.js";
import { JOB_TYPES } from "./types.js";

let harness: JobsHarness;

before(async () => {
  harness = await startJobsHarness();
});

after(async () => {
  await harness.stop();
});

test("telegram ingress enqueues one bot job with inbound_event_id only", async () => {
  const first = await persistInboundAndEnqueue(harness.db, {
    provider: "telegram",
    eventType: "message",
    externalEventId: "1001",
    payload: { update_id: 1001, message: { text: "/start" } },
  });
  const replay = await persistInboundAndEnqueue(harness.db, {
    provider: "telegram",
    eventType: "message",
    externalEventId: "1001",
    payload: { update_id: 1001, message: { text: "/start" } },
  });
  assert.equal(first.created, true);
  assert.equal(replay.created, false);
  assert.equal(first.eventId, replay.eventId);
  assert.equal(first.jobId, replay.jobId);

  const eventRows = await harness.db
    .select()
    .from(inboundEvents)
    .where(eq(inboundEvents.externalEventId, "1001"));
  const jobRows = await harness.db
    .select()
    .from(jobs)
    .where(eq(jobs.id, first.jobId));
  assert.equal(eventRows.length, 1);
  assert.equal(jobRows.length, 1);
  assert.equal(jobRows[0]?.owner, "bot");
  assert.equal(jobRows[0]?.type, JOB_TYPES.telegramProcessInbound);
  assert.deepEqual(jobRows[0]?.payload, { inbound_event_id: first.eventId });
});

test("kick ingress enqueues a worker job and does not touch wallets", async () => {
  const user = await provisionUser(harness.db);
  const result = await persistInboundAndEnqueue(harness.db, {
    provider: "kick",
    eventType: "channel.subscription",
    externalEventId: "kick-evt-1",
    payload: { id: "kick-evt-1" },
  });
  assert.equal(result.created, true);
  const jobRows = await harness.db
    .select()
    .from(jobs)
    .where(eq(jobs.id, result.jobId));
  assert.equal(jobRows[0]?.owner, "worker");
  assert.equal(jobRows[0]?.type, JOB_TYPES.kickProcessInbound);

  const walletRows = await harness.db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, user.userId));
  assert.equal(walletRows[0]?.balanceMinor, 0n);
  const ledger = await harness.db.select().from(walletTransactions);
  assert.equal(ledger.length, 0);
});

test("HTTP idempotency replays the same response and rejects a body mismatch", async () => {
  const user = await provisionUser(harness.db);
  let runs = 0;
  const first = await runIdempotentPost(
    harness.db,
    {
      userId: user.userId,
      route: "POST /test",
      key: "key-1",
      requestHash: "hash-a",
    },
    async () => {
      runs += 1;
      return { status: 200, body: { ok: true } };
    },
  );
  const replay = await runIdempotentPost(
    harness.db,
    {
      userId: user.userId,
      route: "POST /test",
      key: "key-1",
      requestHash: "hash-a",
    },
    async () => {
      runs += 1;
      return { status: 200, body: { ok: false } };
    },
  );
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.body, { ok: true });
  assert.equal(runs, 1);
  await assert.rejects(
    () =>
      runIdempotentPost(
        harness.db,
        {
          userId: user.userId,
          route: "POST /test",
          key: "key-1",
          requestHash: "hash-b",
        },
        async () => ({ status: 200, body: { ok: true } }),
      ),
    IdempotencyConflictError,
  );
});

test("worker claim cannot take telegram bot jobs", async () => {
  const botJob = await persistInboundAndEnqueue(harness.db, {
    provider: "telegram",
    eventType: "message",
    externalEventId: "19001",
    payload: { update_id: 19001, message: { text: "/start" } },
  });
  const workerJob = await persistInboundAndEnqueue(harness.db, {
    provider: "kick",
    eventType: "channel.subscription",
    externalEventId: "kick-claim-isolation-1",
    payload: { id: "kick-claim-isolation-1" },
  });

  for (let i = 0; i < 8; i += 1) {
    const claimed = await claimNextJob(harness.db, {
      owner: "worker",
      lockedBy: "worker-claim-test",
    });
    if (!claimed) {
      break;
    }
    assert.equal(claimed.owner, "worker");
    assert.notEqual(claimed.id, botJob.jobId);
    assert.ok(!claimed.type.startsWith("telegram."));
  }

  let sawBotJob = false;
  for (let i = 0; i < 8; i += 1) {
    const claimed = await claimNextJob(harness.db, {
      owner: "bot",
      lockedBy: "bot-claim-test",
    });
    if (!claimed) {
      break;
    }
    assert.equal(claimed.owner, "bot");
    assert.notEqual(claimed.id, workerJob.jobId);
    if (claimed.id === botJob.jobId) {
      sawBotJob = true;
    }
  }
  assert.equal(sawBotJob, true);
});

test("inbound correlation is stored on the event and job, not in the payload", async () => {
  const persisted = await persistInboundAndEnqueue(harness.db, {
    provider: "telegram",
    eventType: "message",
    externalEventId: "12012",
    payload: { update_id: 12012 },
    correlationId: "corr-phase12",
  });
  const event = (
    await harness.db
      .select()
      .from(inboundEvents)
      .where(eq(inboundEvents.id, persisted.eventId))
  )[0];
  const job = (
    await harness.db.select().from(jobs).where(eq(jobs.id, persisted.jobId))
  )[0];
  assert.equal(event?.correlationId, "corr-phase12");
  assert.equal(job?.correlationId, "corr-phase12");
  assert.deepEqual(job?.payload, { inbound_event_id: persisted.eventId });
});

test("reconcile sweep enqueue is idempotent in one window", async () => {
  const now = new Date("2026-09-13T12:00:00.000Z");
  const first = await enqueueReconcileSweep(harness.db, now);
  const replay = await enqueueReconcileSweep(harness.db, now);
  assert.equal(first.created, true);
  assert.equal(replay.created, false);
  assert.equal(first.jobId, replay.jobId);
  const job = (
    await harness.db.select().from(jobs).where(eq(jobs.id, first.jobId))
  )[0];
  assert.equal(job?.type, JOB_TYPES.walletReconcile);
  assert.deepEqual(job?.payload, {});
});

test("kick refresh sweep enqueues due active accounts once per window", async () => {
  const { encryptSecret, linkKickAccount, parseTokenEncryptionKey, provisionUser } =
    await import("@giftbot/domain");
  const key = parseTokenEncryptionKey("ab".repeat(32));
  const user = await provisionUser(harness.db);
  const linked = await linkKickAccount(harness.db, {
    userId: user.userId,
    kickUserId: `kick-refresh-sweep-${String(Date.now())}`,
    accessTokenEncrypted: encryptSecret(key, "access"),
    refreshTokenEncrypted: encryptSecret(key, "refresh"),
    tokenExpiresAt: new Date("2026-09-13T11:55:00.000Z"),
  });
  const now = new Date("2026-09-13T12:00:00.000Z");
  const first = await enqueueDueKickTokenRefreshes(harness.db, now);
  const replay = await enqueueDueKickTokenRefreshes(harness.db, now);
  const created = first.find((r) => r.created);
  assert.ok(created);
  const replaySame = replay.find((r) => r.jobId === created.jobId);
  assert.ok(replaySame);
  assert.equal(replaySame.created, false);
  const job = (
    await harness.db.select().from(jobs).where(eq(jobs.id, created.jobId))
  )[0];
  assert.equal(job?.type, JOB_TYPES.kickRefreshToken);
  assert.deepEqual(job?.payload, { kick_account_id: linked.id });
});
