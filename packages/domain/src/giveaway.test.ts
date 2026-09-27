import {
  giveawayEntries,
  giveawayWinners,
  giveaways,
  jobs,
  kickAccounts,
  notifications,
  rngDraws,
  walletTransactions,
} from "@giftbot/db/schema";
import { and, eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ConflictError, DomainError, NotFoundError } from "./errors.js";
import {
  activateGiveaway,
  cancelGiveaway,
  createGiveaway,
  drawGiveaway,
  joinGiveaway,
  listGiveawaysForUser,
  markCustomPrizeDelivered,
  toPublicStatus,
  updateDraftGiveaway,
} from "./giveaway.js";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import { asBigInt } from "./money.js";
import { provisionUser } from "./user.js";
import { reconcileWallet } from "./wallet.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

async function linkKick(userId: string, kickUserId: string): Promise<void> {
  await harness.db.insert(kickAccounts).values({
    userId,
    kickUserId,
    status: "active",
  });
}

async function unlinkKick(userId: string): Promise<void> {
  await harness.db
    .update(kickAccounts)
    .set({ status: "revoked" })
    .where(eq(kickAccounts.userId, userId));
}

async function createOpenCoinsGiveaway(input: {
  adminUserId: string;
  title: string;
  bankAzc: bigint;
  winnerCount: number;
  endsAt?: Date;
}): Promise<string> {
  const endsAt = input.endsAt ?? new Date(Date.now() + 60_000);
  const created = await createGiveaway(harness.db, {
    title: input.title,
    type: "coins",
    bankAzc: input.bankAzc,
    winnerCount: input.winnerCount,
    endsAt,
    adminUserId: input.adminUserId,
    reason: "test create",
  });
  await activateGiveaway(harness.db, {
    giveawayId: created.giveaway.id,
    adminUserId: input.adminUserId,
    reason: "test activate",
  });
  return created.giveaway.id;
}

async function forceEnded(giveawayId: string): Promise<void> {
  await harness.db
    .update(giveaways)
    .set({ endsAt: new Date(Date.now() - 1_000), updatedAt: new Date() })
    .where(eq(giveaways.id, giveawayId));
}

test("toPublicStatus maps db statuses to product names", () => {
  assert.equal(toPublicStatus("open"), "active");
  assert.equal(toPublicStatus("closed"), "drawing");
  assert.equal(toPublicStatus("settled"), "completed");
  assert.equal(toPublicStatus("draft"), "draft");
  assert.equal(toPublicStatus("cancelled"), "cancelled");
});

test("coins bank must be positive and divisible by winnerCount", async () => {
  const admin = await provisionUser(harness.db);
  await assert.rejects(
    () =>
      createGiveaway(harness.db, {
        title: "bad bank",
        type: "coins",
        bankAzc: 0n,
        winnerCount: 1,
        adminUserId: admin.userId,
        reason: "x",
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "GIVEAWAY_INVALID_BANK",
  );
  await assert.rejects(
    () =>
      createGiveaway(harness.db, {
        title: "not divisible",
        type: "coins",
        bankAzc: 100n,
        winnerCount: 3,
        adminUserId: admin.userId,
        reason: "x",
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "GIVEAWAY_INVALID_BANK",
  );
  const ok = await createGiveaway(harness.db, {
    title: "ok bank",
    type: "coins",
    bankAzc: 300n,
    winnerCount: 3,
    adminUserId: admin.userId,
    reason: "ok",
  });
  assert.equal(ok.giveaway.bankAzc, "300");
  assert.equal(ok.giveaway.winnerCount, 3);
  const row = (
    await harness.db
      .select()
      .from(giveaways)
      .where(eq(giveaways.id, ok.giveaway.id))
  )[0];
  assert.equal(asBigInt(row?.prizePerWinnerAzc ?? 0n), 100n);
});

test("join requires open status, Kick link, and is idempotent", async () => {
  const admin = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  const endsAt = new Date(Date.now() + 60_000);
  const draft = await createGiveaway(harness.db, {
    title: "join draft",
    type: "coins",
    bankAzc: 100n,
    winnerCount: 1,
    endsAt,
    adminUserId: admin.userId,
    reason: "create",
  });
  await assert.rejects(
    () =>
      joinGiveaway(harness.db, {
        giveawayId: draft.giveaway.id,
        userId: user.userId,
      }),
    (err: unknown) =>
      err instanceof ConflictError && err.code === "GIVEAWAY_CLOSED",
  );

  await activateGiveaway(harness.db, {
    giveawayId: draft.giveaway.id,
    adminUserId: admin.userId,
    reason: "activate",
  });
  await assert.rejects(
    () =>
      joinGiveaway(harness.db, {
        giveawayId: draft.giveaway.id,
        userId: user.userId,
      }),
    (err: unknown) =>
      err instanceof ConflictError && err.code === "GIVEAWAY_NOT_ELIGIBLE",
  );

  await linkKick(user.userId, `kick-join-${user.userId.slice(0, 8)}`);
  const first = await joinGiveaway(harness.db, {
    giveawayId: draft.giveaway.id,
    userId: user.userId,
  });
  assert.equal(first.replayed, false);
  const second = await joinGiveaway(harness.db, {
    giveawayId: draft.giveaway.id,
    userId: user.userId,
  });
  assert.equal(second.replayed, true);
  assert.equal(second.id, first.id);

  const entries = await harness.db
    .select()
    .from(giveawayEntries)
    .where(eq(giveawayEntries.giveawayId, draft.giveaway.id));
  assert.equal(entries.length, 1);

  const drawJobs = await harness.db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.type, "giveaway.draw"),
        eq(jobs.idempotencyKey, `giveaway.draw:${draft.giveaway.id}`),
      ),
    );
  assert.equal(drawJobs.length, 1);
  assert.equal(drawJobs[0]?.owner, "worker");
  assert.ok(drawJobs[0]?.nextAttemptAt);
  assert.equal(
    drawJobs[0]!.nextAttemptAt!.getTime(),
    endsAt.getTime(),
  );
});

test("draw selects unique winners, credits wallets, and is concurrency-safe", async () => {
  const admin = await provisionUser(harness.db);
  const users = await Promise.all([
    provisionUser(harness.db),
    provisionUser(harness.db),
    provisionUser(harness.db),
    provisionUser(harness.db),
  ]);
  for (const [i, user] of users.entries()) {
    await linkKick(user.userId, `kick-draw-${i}-${user.userId.slice(0, 8)}`);
  }
  const giveawayId = await createOpenCoinsGiveaway({
    adminUserId: admin.userId,
    title: "draw coins",
    bankAzc: 300n,
    winnerCount: 2,
  });
  for (const user of users) {
    await joinGiveaway(harness.db, {
      giveawayId,
      userId: user.userId,
    });
  }
  await forceEnded(giveawayId);

  const [a, b] = await Promise.all([
    drawGiveaway(harness.db, giveawayId),
    drawGiveaway(harness.db, giveawayId),
  ]);
  const results = [a, b];
  assert.ok(results.some((r) => r.noop === false));
  assert.ok(results.every((r) => r.status === "settled"));
  assert.equal(
    results.find((r) => !r.noop)?.actualWinnerCount,
    2,
  );

  const winners = await harness.db
    .select()
    .from(giveawayWinners)
    .where(eq(giveawayWinners.giveawayId, giveawayId));
  assert.equal(winners.length, 2);
  const winnerUserIds = new Set(winners.map((w) => w.userId));
  assert.equal(winnerUserIds.size, 2);

  const draws = await harness.db
    .select()
    .from(rngDraws)
    .where(eq(rngDraws.purpose, "giveaway"));
  assert.ok(draws.length >= 2);
  assert.ok(draws.every((d) => d.algorithm.includes("rejection")));

  for (const winner of winners) {
    const report = await reconcileWallet(harness.db, winner.userId);
    assert.equal(report.consistent, true);
    assert.equal(report.balanceMinor, 150n);
    const ledger = await harness.db
      .select()
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.userId, winner.userId),
          eq(walletTransactions.type, "giveaway_reward"),
        ),
      );
    assert.equal(ledger.length, 1);
    assert.equal(
      ledger[0]?.idempotencyKey,
      `giveaway.reward:${giveawayId}:${winner.userId}`,
    );
    const notes = await harness.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, winner.userId),
          eq(notifications.type, "giveaway_win"),
        ),
      );
    assert.equal(notes.length, 1);
  }

  const third = await drawGiveaway(harness.db, giveawayId);
  assert.equal(third.noop, true);
  assert.equal(third.status, "settled");

  const listed = await listGiveawaysForUser(harness.db, {
    userId: users[0]!.userId,
    tab: "completed",
  });
  const item = listed.items.find((row) => row.id === giveawayId);
  assert.ok(item);
  assert.equal(item.status, "completed");
  assert.equal(item.winners?.length, 2);
});

test("draw re-checks Kick eligibility and shrinks actualWinnerCount", async () => {
  const admin = await provisionUser(harness.db);
  const eligible = await provisionUser(harness.db);
  const revoked = await provisionUser(harness.db);
  await linkKick(eligible.userId, `kick-elig-${eligible.userId.slice(0, 8)}`);
  await linkKick(revoked.userId, `kick-rev-${revoked.userId.slice(0, 8)}`);
  const giveawayId = await createOpenCoinsGiveaway({
    adminUserId: admin.userId,
    title: "elig shrink",
    bankAzc: 200n,
    winnerCount: 2,
  });
  await joinGiveaway(harness.db, {
    giveawayId,
    userId: eligible.userId,
  });
  await joinGiveaway(harness.db, {
    giveawayId,
    userId: revoked.userId,
  });
  await unlinkKick(revoked.userId);
  await forceEnded(giveawayId);

  const result = await drawGiveaway(harness.db, giveawayId);
  assert.equal(result.actualWinnerCount, 1);
  const winners = await harness.db
    .select()
    .from(giveawayWinners)
    .where(eq(giveawayWinners.giveawayId, giveawayId));
  assert.equal(winners.length, 1);
  assert.equal(winners[0]?.userId, eligible.userId);
});

test("custom prize settles with pending_delivery and admin can mark delivered", async () => {
  const admin = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await linkKick(user.userId, `kick-custom-${user.userId.slice(0, 8)}`);
  const created = await createGiveaway(harness.db, {
    title: "custom prize",
    type: "custom_prize",
    customPrize: "Telegram Premium",
    winnerCount: 1,
    endsAt: new Date(Date.now() + 60_000),
    adminUserId: admin.userId,
    reason: "create custom",
  });
  await activateGiveaway(harness.db, {
    giveawayId: created.giveaway.id,
    adminUserId: admin.userId,
    reason: "activate custom",
  });
  await joinGiveaway(harness.db, {
    giveawayId: created.giveaway.id,
    userId: user.userId,
  });
  await forceEnded(created.giveaway.id);
  const drawn = await drawGiveaway(harness.db, created.giveaway.id);
  assert.equal(drawn.status, "settled");
  assert.equal(drawn.actualWinnerCount, 1);

  const winners = await harness.db
    .select()
    .from(giveawayWinners)
    .where(eq(giveawayWinners.giveawayId, created.giveaway.id));
  assert.equal(winners.length, 1);
  assert.equal(winners[0]?.deliveryStatus, "pending_delivery");
  assert.equal(winners[0]?.prizeText, "Telegram Premium");
  assert.equal(winners[0]?.prizeAzc, null);
  assert.equal(winners[0]?.rewardTransactionId, null);

  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 0n);

  const marked = await markCustomPrizeDelivered(harness.db, {
    giveawayId: created.giveaway.id,
    winnerUserId: user.userId,
    adminUserId: admin.userId,
    reason: "handed over",
  });
  assert.equal(marked.replayed, false);
  const replay = await markCustomPrizeDelivered(harness.db, {
    giveawayId: created.giveaway.id,
    winnerUserId: user.userId,
    adminUserId: admin.userId,
    reason: "again",
  });
  assert.equal(replay.replayed, true);

  const after = (
    await harness.db
      .select()
      .from(giveawayWinners)
      .where(eq(giveawayWinners.id, winners[0]!.id))
  )[0];
  assert.equal(after?.deliveryStatus, "delivered");
  assert.ok(after?.deliveredAt);
  assert.equal(after?.deliveredBy, admin.userId);
});

test("cancel before draw is allowed and cancelled draw is a no-op", async () => {
  const admin = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await linkKick(user.userId, `kick-cancel-${user.userId.slice(0, 8)}`);
  const created = await createGiveaway(harness.db, {
    title: "cancel me",
    type: "coins",
    bankAzc: 50n,
    winnerCount: 1,
    endsAt: new Date(Date.now() + 60_000),
    adminUserId: admin.userId,
    reason: "create",
  });
  await activateGiveaway(harness.db, {
    giveawayId: created.giveaway.id,
    adminUserId: admin.userId,
    reason: "activate",
  });
  await joinGiveaway(harness.db, {
    giveawayId: created.giveaway.id,
    userId: user.userId,
  });
  await cancelGiveaway(harness.db, {
    giveawayId: created.giveaway.id,
    adminUserId: admin.userId,
    reason: "abort",
  });
  await forceEnded(created.giveaway.id);
  const drawn = await drawGiveaway(harness.db, created.giveaway.id);
  assert.equal(drawn.noop, true);
  assert.equal(drawn.status, "cancelled");
  const winners = await harness.db
    .select()
    .from(giveawayWinners)
    .where(eq(giveawayWinners.giveawayId, created.giveaway.id));
  assert.equal(winners.length, 0);
});

test("edit is only allowed in draft; activate freezes config", async () => {
  const admin = await provisionUser(harness.db);
  const created = await createGiveaway(harness.db, {
    title: "draft edit",
    type: "coins",
    bankAzc: 100n,
    winnerCount: 1,
    endsAt: new Date(Date.now() + 10_000),
    adminUserId: admin.userId,
    reason: "create",
  });
  const updated = await updateDraftGiveaway(harness.db, {
    giveawayId: created.giveaway.id,
    title: "edited title",
    bankAzc: 200n,
    winnerCount: 2,
    adminUserId: admin.userId,
    reason: "edit",
  });
  assert.equal(updated.giveaway.title, "edited title");
  assert.equal(updated.giveaway.bankAzc, "200");
  assert.equal(updated.giveaway.winnerCount, 2);

  await activateGiveaway(harness.db, {
    giveawayId: created.giveaway.id,
    adminUserId: admin.userId,
    reason: "activate",
  });
  await assert.rejects(
    () =>
      updateDraftGiveaway(harness.db, {
        giveawayId: created.giveaway.id,
        title: "nope",
        adminUserId: admin.userId,
        reason: "late edit",
      }),
    (err: unknown) =>
      err instanceof ConflictError && err.code === "GIVEAWAY_INVALID_STATE",
  );
});

test("unknown giveaway returns GIVEAWAY_NOT_FOUND", async () => {
  await assert.rejects(
    () =>
      joinGiveaway(harness.db, {
        giveawayId: "00000000-0000-4000-8000-000000000099",
        userId: "00000000-0000-4000-8000-000000000098",
      }),
    (err: unknown) =>
      err instanceof NotFoundError && err.code === "GIVEAWAY_NOT_FOUND",
  );
});

test("create giveaway without image returns null imageUrl", async () => {
  const admin = await provisionUser(harness.db);
  const created = await createGiveaway(harness.db, {
    title: "no photo",
    type: "coins",
    bankAzc: 100n,
    winnerCount: 1,
    adminUserId: admin.userId,
    reason: "image optional",
  });
  assert.equal(created.giveaway.imageUrl, null);
});

test("create giveaway with valid imageUrl returns it on public list", async () => {
  const admin = await provisionUser(harness.db);
  const imageUrl =
    "/giveaways/media/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png";
  const created = await createGiveaway(harness.db, {
    title: "with photo",
    type: "coins",
    bankAzc: 100n,
    winnerCount: 1,
    endsAt: new Date(Date.now() + 60_000),
    imageUrl,
    adminUserId: admin.userId,
    reason: "image set",
  });
  assert.equal(created.giveaway.imageUrl, imageUrl);
  await activateGiveaway(harness.db, {
    giveawayId: created.giveaway.id,
    adminUserId: admin.userId,
    reason: "open",
  });
  const user = await provisionUser(harness.db);
  await linkKick(user.userId, `kick-${user.userId}`);
  const listed = await listGiveawaysForUser(harness.db, {
    userId: user.userId,
    tab: "active",
  });
  const row = listed.items.find((item) => item.id === created.giveaway.id);
  assert.ok(row);
  assert.equal(row.imageUrl, imageUrl);
});

test("invalid giveaway imageUrl is rejected", async () => {
  const admin = await provisionUser(harness.db);
  await assert.rejects(
    () =>
      createGiveaway(harness.db, {
        title: "bad image",
        type: "coins",
        bankAzc: 100n,
        winnerCount: 1,
        imageUrl: "/etc/passwd",
        adminUserId: admin.userId,
        reason: "nope",
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "BAD_REQUEST",
  );
});
