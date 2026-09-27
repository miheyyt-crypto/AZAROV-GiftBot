import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import {
  invalidateBalanceLeaderboardCache,
  listBalanceLeaderboard,
} from "./leaderboard.js";
import { apply } from "./wallet.js";
import { provisionUser } from "./user.js";
import {
  attributeReferral,
  listReferralLeaderboard,
  onKickAccountLinked,
} from "./referral.js";
import { linkKickAccount } from "./kick.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

async function credit(userId: string, amount: bigint, key: string): Promise<void> {
  await apply(harness.db, {
    userId,
    type: "admin_adjustment",
    amountMinor: amount,
    idempotencyKey: key,
    actorType: "admin",
    reason: "test credit",
  });
}

test("balance leaderboard ranks by current balance with deterministic ties", async () => {
  invalidateBalanceLeaderboardCache();
  const a = await provisionUser(harness.db, { displayName: "A" });
  const b = await provisionUser(harness.db, { displayName: "B" });
  const c = await provisionUser(harness.db, { displayName: "C" });
  const d = await provisionUser(harness.db, { displayName: "D" });

  await credit(a.userId, 10_000n, `lb-a-${a.userId}`);
  await credit(b.userId, 5_000n, `lb-b-${b.userId}`);
  await credit(c.userId, 5_000n, `lb-c-${c.userId}`);
  await credit(d.userId, 100n, `lb-d-${d.userId}`);
  invalidateBalanceLeaderboardCache();

  const board = await listBalanceLeaderboard(harness.db, {
    userId: d.userId,
  });
  const byName = new Map(
    board.items.map((row) => [row.displayName, row] as const),
  );
  assert.equal(byName.get("A")?.rank, 1);
  assert.equal(byName.get("A")?.balanceAzc, "10000");
  const bRank = byName.get("B")?.rank;
  const cRank = byName.get("C")?.rank;
  assert.ok(bRank === 2 || bRank === 3);
  assert.ok(cRank === 2 || cRank === 3);
  assert.notEqual(bRank, cRank);
  // earlier created_at wins among equal balances
  assert.ok((bRank ?? 99) < (cRank ?? 0));
  assert.equal(byName.get("D")?.rank, 4);
  assert.equal(board.self?.isYou, true);
  assert.equal(board.self?.rank, 4);
});

test("balance TOP100 caps items and returns exact self rank outside", async () => {
  invalidateBalanceLeaderboardCache();
  const outsider = await provisionUser(harness.db, { displayName: "Out" });
  await credit(outsider.userId, 1n, `lb-out-${outsider.userId}`);

  const rich: string[] = [];
  for (let i = 0; i < 101; i += 1) {
    const user = await provisionUser(harness.db, {
      displayName: `Rich${String(i)}`,
    });
    await credit(user.userId, BigInt(200_000 - i), `lb-rich-${user.userId}`);
    rich.push(user.userId);
  }
  invalidateBalanceLeaderboardCache();

  const board = await listBalanceLeaderboard(harness.db, {
    userId: outsider.userId,
  });
  assert.equal(board.items.length, 100);
  assert.equal(board.items[0]?.rank, 1);
  assert.equal(board.items[99]?.rank, 100);
  assert.ok(board.self);
  assert.equal(board.self?.isYou, true);
  assert.ok((board.self?.rank ?? 0) > 100);
  assert.ok(!board.items.some((row) => row.isYou));
  assert.equal(board.self?.balanceAzc, "1");
});

test("balance leaderboard uses current balance not lifetime", async () => {
  invalidateBalanceLeaderboardCache();
  const user = await provisionUser(harness.db, { displayName: "Flip" });
  await credit(user.userId, 50_000n, `lb-flip-in-${user.userId}`);
  await apply(harness.db, {
    userId: user.userId,
    type: "admin_adjustment",
    amountMinor: -49_000n,
    idempotencyKey: `lb-flip-out-${user.userId}`,
    actorType: "admin",
    reason: "test debit",
  });
  invalidateBalanceLeaderboardCache();
  const board = await listBalanceLeaderboard(harness.db, {
    userId: user.userId,
  });
  const self = board.self ?? board.items.find((row) => row.isYou);
  assert.ok(self);
  assert.equal(self?.balanceAzc, "1000");
});

test("referral leaderboard counts activated only and ties by created_at", async () => {
  const a = await provisionUser(harness.db, { displayName: "RefA" });
  const b = await provisionUser(harness.db, { displayName: "RefB" });
  const c = await provisionUser(harness.db, { displayName: "RefC" });
  const d = await provisionUser(harness.db, { displayName: "RefD" });

  async function activateN(
    referrer: { userId: string; referralCode: string },
    n: number,
    tag: string,
  ): Promise<void> {
    for (let i = 0; i < n; i += 1) {
      const referee = await provisionUser(harness.db);
      await attributeReferral(harness.db, {
        refereeUserId: referee.userId,
        code: referrer.referralCode,
      });
      await linkKickAccount(harness.db, {
        userId: referee.userId,
        kickUserId: `kick-${tag}-${i}-${referee.userId}`,
      });
      await onKickAccountLinked(harness.db, referee.userId);
    }
  }

  await activateN(a, 10, "a");
  await activateN(b, 8, "b");
  await activateN(c, 8, "c");
  await activateN(d, 1, "d");

  // attributed but not activated must not count
  const pending = await provisionUser(harness.db);
  await attributeReferral(harness.db, {
    refereeUserId: pending.userId,
    code: d.referralCode,
  });

  const board = await listReferralLeaderboard(harness.db, { userId: d.userId });
  const byName = new Map(
    board.items.map((row) => [row.displayName, row] as const),
  );
  assert.equal(byName.get("RefA")?.activeReferrals, 10);
  assert.equal(byName.get("RefA")?.rank, 1);
  const bRank = byName.get("RefB")?.rank;
  const cRank = byName.get("RefC")?.rank;
  assert.ok(bRank === 2 || bRank === 3);
  assert.ok(cRank === 2 || cRank === 3);
  assert.ok((bRank ?? 99) < (cRank ?? 0));
  assert.equal(byName.get("RefD")?.activeReferrals, 1);
  assert.equal(board.self?.activeReferrals, 1);
});
