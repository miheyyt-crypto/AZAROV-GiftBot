import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import { v1ImportIdentities, walletTransactions, wallets } from "@giftbot/db/schema";
import type { DevPostgres } from "@giftbot/db";
import { apply, asBigInt, identifyTelegramUser, reconcileWallet } from "@giftbot/domain";
import { eq } from "drizzle-orm";
import { importV1Users, planV1Import } from "./import.js";
import { parseV1Export, type V1ExportDocument } from "./parse.js";

const IMPORT_PORT = 55452;

function snapshotSource(): V1ExportDocument {
  return parseV1Export({
    format: "giftbot-v1-export",
    version: 1,
    users: [
      {
        telegram_user_id: 9001,
        first_name: "Imported",
        balance_minor: 400,
        legacy_id: "v1-user-9001",
      },
    ],
  });
}

function historySource(): V1ExportDocument {
  return parseV1Export({
    format: "giftbot-v1-export",
    version: 1,
    users: [
      {
        telegram_user_id: 9002,
        balance_minor: 150,
        ledger: [
          { legacy_tx_id: "tx-a", type: "deposit", amount_minor: 200 },
          { legacy_tx_id: "tx-b", type: "bet", amount_minor: -50 },
        ],
      },
    ],
  });
}

let postgres: DevPostgres;
let handle: ReturnType<typeof createDb>;

before(async () => {
  postgres = await startDevPostgres({ port: IMPORT_PORT, forceEmbedded: true });
  await runMigrations(postgres.url);
  handle = createDb(postgres.url);
});

after(async () => {
  await handle.sql.end({ timeout: 5 });
  await postgres.stop();
});

test("dry-run writes no users, wallets, or import identities", async () => {
  const planned = planV1Import(snapshotSource(), "snapshot");
  assert.equal(planned.dryRun, true);
  assert.equal(planned.imported, 0);
  assert.equal(planned.rows[0]?.action, "would_import");

  const report = await importV1Users(handle.db, snapshotSource(), {
    mode: "snapshot",
    dryRun: true,
  });
  assert.equal(report.dryRun, true);

  const identities = await handle.db.select().from(v1ImportIdentities);
  assert.equal(identities.length, 0);
  const walletRows = await handle.db.select().from(wallets);
  assert.equal(walletRows.length, 0);
});

test("snapshot sets opening_balance and does not copy V1 history", async () => {
  const first = await importV1Users(handle.db, snapshotSource(), {
    mode: "snapshot",
    dryRun: false,
  });
  assert.equal(first.imported, 1);
  assert.equal(first.conflicts, 0);
  assert.equal(first.reconcileOk, true);
  const userId = first.rows[0]?.userId;
  assert.ok(userId);

  const walletRows = await handle.db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, userId));
  const wallet = walletRows[0];
  assert.ok(wallet);
  assert.equal(asBigInt(wallet.openingBalanceMinor), 400n);
  assert.equal(asBigInt(wallet.balanceMinor), 400n);

  const ledger = await handle.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, userId));
  assert.equal(ledger.length, 0);

  const recon = await reconcileWallet(handle.db, userId);
  assert.equal(recon.consistent, true);
  assert.equal(recon.expectedMinor, 400n);

  const second = await importV1Users(handle.db, snapshotSource(), {
    mode: "snapshot",
    dryRun: false,
  });
  assert.equal(second.imported, 0);
  assert.equal(second.skipped, 1);
  const after = await handle.db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, userId));
  assert.equal(asBigInt(after[0]?.balanceMinor ?? -1n), 400n);
});

test("full_history opens at 0 and uses import:v1 ledger keys", async () => {
  const first = await importV1Users(handle.db, historySource(), {
    mode: "full_history",
    dryRun: false,
  });
  assert.equal(first.imported, 1);
  assert.equal(first.reconcileOk, true);
  const userId = first.rows[0]?.userId;
  assert.ok(userId);

  const walletRows = await handle.db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, userId));
  assert.equal(asBigInt(walletRows[0]?.openingBalanceMinor ?? -1n), 0n);
  assert.equal(asBigInt(walletRows[0]?.balanceMinor ?? -1n), 150n);

  const ledger = await handle.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, userId));
  assert.equal(ledger.length, 2);
  assert.deepEqual(
    ledger.map((row) => row.idempotencyKey).sort(),
    ["import:v1:tx-a", "import:v1:tx-b"],
  );

  const second = await importV1Users(handle.db, historySource(), {
    mode: "full_history",
    dryRun: false,
  });
  assert.equal(second.skipped, 1);
  const ledgerAfter = await handle.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, userId));
  assert.equal(ledgerAfter.length, 2);
});

test("refuses snapshot plus history for the same amounts", () => {
  const mixed = parseV1Export({
    format: "giftbot-v1-export",
    version: 1,
    users: [
      {
        telegram_user_id: 9003,
        balance_minor: 50,
        ledger: [{ legacy_tx_id: "tx-x", type: "deposit", amount_minor: 50 }],
      },
    ],
  });
  const snapshot = planV1Import(mixed, "snapshot");
  assert.equal(snapshot.conflicts, 1);
  const history = planV1Import(
    parseV1Export({
      format: "giftbot-v1-export",
      version: 1,
      users: [
        {
          telegram_user_id: 9003,
          balance_minor: 50,
          ledger: [
            { legacy_tx_id: "tx-x", type: "deposit", amount_minor: 50 },
            { legacy_tx_id: "tx-y", type: "deposit", amount_minor: 50 },
          ],
        },
      ],
    }),
    "full_history",
  );
  assert.equal(history.conflicts, 1);
});

test("snapshot on a runtime user adds V1 opening without dropping V2 ledger", async () => {
  const identified = await identifyTelegramUser(handle.db, {
    telegramUserId: 9004n,
    firstName: "Live",
  });
  await apply(handle.db, {
    userId: identified.userId,
    type: "deposit",
    amountMinor: 25n,
    idempotencyKey: "runtime-deposit-9004",
    actorType: "system",
  });

  const source = parseV1Export({
    format: "giftbot-v1-export",
    version: 1,
    users: [{ telegram_user_id: 9004, balance_minor: 75 }],
  });
  const report = await importV1Users(handle.db, source, {
    mode: "snapshot",
    dryRun: false,
  });
  assert.equal(report.imported, 1);
  const recon = await reconcileWallet(handle.db, identified.userId);
  assert.equal(recon.openingBalanceMinor, 75n);
  assert.equal(recon.ledgerSumMinor, 25n);
  assert.equal(recon.balanceMinor, 100n);
  assert.equal(recon.consistent, true);
});
