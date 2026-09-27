import { adminRoleAssignments, adminRoles, auditLogs, wallets } from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { adjustWallet, readAdminLedgerView, readAdminWalletView } from "./admin.js";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import { provisionUser } from "./user.js";
import { reconcileWallet } from "./wallet.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

test("wallet.adjust writes ledger, audit, and reason in one transaction", async () => {
  const admin = await provisionUser(harness.db);
  const target = await provisionUser(harness.db);
  const roles = await harness.db
    .select()
    .from(adminRoles)
    .where(eq(adminRoles.name, "super_admin"))
    .limit(1);
  assert.ok(roles[0]);
  await harness.db.insert(adminRoleAssignments).values({
    userId: admin.userId,
    roleId: roles[0].id,
  });

  const first = await adjustWallet(harness.db, {
    targetUserId: target.userId,
    amountMinor: 7n,
    reason: "correction after support ticket",
    idempotencyKey: `wallet.adjust:${target.userId}:phase11`,
    adminUserId: admin.userId,
  });
  assert.equal(first.replayed, false);
  assert.ok(first.auditId);
  assert.equal(first.applied.transaction.type, "admin_adjustment");
  assert.equal(first.applied.transaction.reason, "correction after support ticket");
  assert.equal(first.applied.wallet.balanceMinor, 7n);

  const replay = await adjustWallet(harness.db, {
    targetUserId: target.userId,
    amountMinor: 7n,
    reason: "correction after support ticket",
    idempotencyKey: `wallet.adjust:${target.userId}:phase11`,
    adminUserId: admin.userId,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.applied.transaction.id, first.applied.transaction.id);

  const audits = await harness.db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.actorId, admin.userId));
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.action, "wallet.adjust");
  assert.equal(audits[0]?.reason, "correction after support ticket");
  assert.equal(audits[0]?.actorId, admin.userId);

  const report = await reconcileWallet(harness.db, target.userId);
  assert.equal(report.balanceMinor, 7n);
  assert.equal(report.consistent, true);
});

test("wallet.adjust rejects an empty reason and does not write money", async () => {
  const admin = await provisionUser(harness.db);
  const target = await provisionUser(harness.db);
  const auditsBefore = (
    await harness.db.select().from(auditLogs).where(eq(auditLogs.actorId, admin.userId))
  ).length;
  await assert.rejects(
    () =>
      adjustWallet(harness.db, {
        targetUserId: target.userId,
        amountMinor: 3n,
        reason: "   ",
        idempotencyKey: `wallet.adjust:${target.userId}:empty`,
        adminUserId: admin.userId,
      }),
    /reason is required/,
  );
  const report = await reconcileWallet(harness.db, target.userId);
  assert.equal(report.balanceMinor, 0n);
  assert.equal(
    (await harness.db.select().from(auditLogs).where(eq(auditLogs.actorId, admin.userId)))
      .length,
    auditsBefore,
  );
});

test("wallet.adjust can credit a frozen wallet", async () => {
  const admin = await provisionUser(harness.db);
  const target = await provisionUser(harness.db);
  await harness.db
    .update(wallets)
    .set({ status: "frozen" })
    .where(eq(wallets.userId, target.userId));
  const adjusted = await adjustWallet(harness.db, {
    targetUserId: target.userId,
    amountMinor: 2n,
    reason: "frozen wallet correction",
    idempotencyKey: `wallet.adjust:${target.userId}:frozen`,
    adminUserId: admin.userId,
  });
  assert.equal(adjusted.replayed, false);
  assert.equal(adjusted.applied.wallet.balanceMinor, 2n);
  assert.equal(adjusted.applied.wallet.status, "frozen");
  const report = await reconcileWallet(harness.db, target.userId);
  assert.equal(report.consistent, true);
  const audits = await harness.db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.actorId, admin.userId));
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.reason, "frozen wallet correction");
});

test("admin views are read-only", async () => {
  const target = await provisionUser(harness.db);
  const before = (await harness.db.select().from(auditLogs)).length;
  const wallet = await readAdminWalletView(harness.db, target.userId);
  const ledger = await readAdminLedgerView(harness.db, target.userId);
  assert.equal(wallet.balanceMinor, "0");
  assert.equal(wallet.consistent, true);
  assert.equal(ledger.entries.length, 0);
  assert.equal((await harness.db.select().from(auditLogs)).length, before);
  const row = (
    await harness.db.select().from(wallets).where(eq(wallets.userId, target.userId))
  )[0];
  assert.equal(row?.balanceMinor, 0n);
});
