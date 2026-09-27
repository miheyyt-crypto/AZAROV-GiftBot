import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { InsufficientFundsError, WalletFrozenError } from "./errors.js";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import { asBigInt } from "./money.js";
import { provisionUser } from "./user.js";
import { apply, reconcileAllWallets, reconcileWallet, reverse } from "./wallet.js";
import { walletTransactions, wallets } from "@giftbot/db/schema";
import { createCorrelationIds, runWithCorrelation } from "@giftbot/observability";
import { eq } from "drizzle-orm";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

test("new wallet starts at zero and reconciles", async () => {
  const user = await provisionUser(harness.db);
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 0n);
  assert.equal(report.openingBalanceMinor, 0n);
  assert.equal(report.ledgerSumMinor, 0n);
  assert.equal(report.consistent, true);
});

test("apply deposits and stays consistent", async () => {
  const user = await provisionUser(harness.db);
  const result = await apply(harness.db, {
    userId: user.userId,
    type: "deposit",
    amountMinor: 40n,
    idempotencyKey: `deposit:${user.userId}:1`,
    actorType: "system",
  });
  assert.equal(result.replayed, false);
  assert.equal(result.wallet.balanceMinor, 40n);
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.consistent, true);
  assert.equal(report.expectedMinor, 40n);
});

test("duplicate apply is idempotent", async () => {
  const user = await provisionUser(harness.db);
  const input = {
    userId: user.userId,
    type: "deposit" as const,
    amountMinor: 25n,
    idempotencyKey: `deposit:${user.userId}:dup`,
    actorType: "system" as const,
  };
  const [first, second] = await Promise.all([
    apply(harness.db, input),
    apply(harness.db, input),
  ]);
  assert.equal(first.transaction.id, second.transaction.id);
  assert.equal(first.replayed !== second.replayed, true);
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 25n);
  assert.equal(report.consistent, true);
});

test("negative balance is rejected", async () => {
  const user = await provisionUser(harness.db);
  await assert.rejects(
    () =>
      apply(harness.db, {
        userId: user.userId,
        type: "bet",
        amountMinor: -10n,
        idempotencyKey: `bet:${user.userId}:empty`,
        actorType: "user",
        actorId: user.userId,
      }),
    InsufficientFundsError,
  );
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 0n);
  assert.equal(report.consistent, true);
});

test("concurrent debits cannot double spend", async () => {
  const user = await provisionUser(harness.db);
  await apply(harness.db, {
    userId: user.userId,
    type: "deposit",
    amountMinor: 50n,
    idempotencyKey: `deposit:${user.userId}:race`,
    actorType: "system",
  });

  const results = await Promise.allSettled([
    apply(harness.db, {
      userId: user.userId,
      type: "bet",
      amountMinor: -40n,
      idempotencyKey: `bet:${user.userId}:race-a`,
      actorType: "user",
      actorId: user.userId,
    }),
    apply(harness.db, {
      userId: user.userId,
      type: "bet",
      amountMinor: -40n,
      idempotencyKey: `bet:${user.userId}:race-b`,
      actorType: "user",
      actorId: user.userId,
    }),
  ]);

  const fulfilled = results.filter((row) => row.status === "fulfilled");
  const rejected = results.filter((row) => row.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(
    rejected[0] &&
      rejected[0].status === "rejected" &&
      rejected[0].reason instanceof InsufficientFundsError,
  );

  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 10n);
  assert.equal(report.consistent, true);
});

test("reversal writes a new ledger row and restores balance", async () => {
  const user = await provisionUser(harness.db);
  const credit = await apply(harness.db, {
    userId: user.userId,
    type: "reward",
    amountMinor: 15n,
    idempotencyKey: `reward:${user.userId}:1`,
    actorType: "system",
  });
  const reversed = await reverse(harness.db, {
    userId: user.userId,
    originalTransactionId: credit.transaction.id,
    actorType: "admin",
    reason: "test reversal",
  });
  assert.equal(reversed.replayed, false);
  assert.equal(asBigInt(reversed.transaction.amountMinor), -15n);
  assert.notEqual(reversed.transaction.id, credit.transaction.id);

  const again = await reverse(harness.db, {
    userId: user.userId,
    originalTransactionId: credit.transaction.id,
    actorType: "admin",
    reason: "test reversal",
  });
  assert.equal(again.replayed, true);
  assert.equal(again.transaction.id, reversed.transaction.id);

  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 0n);
  assert.equal(report.consistent, true);
});

test("frozen wallet rejects non-admin apply", async () => {
  const user = await provisionUser(harness.db);
  await harness.db
    .update(wallets)
    .set({ status: "frozen" })
    .where(eq(wallets.userId, user.userId));

  await assert.rejects(
    () =>
      apply(harness.db, {
        userId: user.userId,
        type: "deposit",
        amountMinor: 5n,
        idempotencyKey: `deposit:${user.userId}:frozen`,
        actorType: "system",
      }),
    WalletFrozenError,
  );
});

test("apply stamps correlation onto the ledger metadata", async () => {
  const user = await provisionUser(harness.db);
  const ids = createCorrelationIds({ requestId: "req-wallet-1", jobId: "job-wallet-1" });
  await runWithCorrelation(ids, () =>
    apply(harness.db, {
      userId: user.userId,
      type: "deposit",
      amountMinor: 2n,
      idempotencyKey: `deposit:${user.userId}:corr`,
      actorType: "system",
    }),
  );
  const tx = (
    await harness.db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.userId, user.userId))
  )[0];
  const metadata = tx?.metadata as Record<string, unknown> | null;
  assert.equal(metadata?.request_id, "req-wallet-1");
  assert.equal(metadata?.correlation_id, "req-wallet-1");
  assert.equal(metadata?.job_id, "job-wallet-1");
});

test("reconcileAllWallets is read-only and reports a mismatch", async () => {
  const user = await provisionUser(harness.db);
  await harness.db
    .update(wallets)
    .set({ balanceMinor: 9n })
    .where(eq(wallets.userId, user.userId));
  const reports = await reconcileAllWallets(harness.db);
  const mine = reports.find((row) => row.userId === user.userId);
  assert.ok(mine);
  assert.equal(mine.consistent, false);
  assert.equal(mine.balanceMinor, 9n);
  const ledger = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  assert.equal(ledger.length, 0);
  const wallet = (
    await harness.db.select().from(wallets).where(eq(wallets.userId, user.userId))
  )[0];
  assert.equal(wallet?.balanceMinor, 9n);
});
