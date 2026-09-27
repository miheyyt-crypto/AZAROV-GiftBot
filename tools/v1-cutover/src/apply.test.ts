import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import {
  kickAccounts,
  userLevelRewards,
  v1ImportIdentities,
  walletTransactions,
} from "@giftbot/db/schema";
import type { DevPostgres } from "@giftbot/db";
import { decryptSecret, grantLevelRewards, parseTokenEncryptionKey } from "@giftbot/domain";
import { applyV1Cutover, hashCanonicalReport } from "./apply.js";
import { auditV1Store } from "./audit.js";
import { fixtureStore, withKick } from "./fixtures.js";
import { storeFromObject } from "./parse-store.js";

const KEY = "aa".repeat(32);
const PORT = 55492;

let postgres: DevPostgres;
let url: string;

before(async () => {
  postgres = await startDevPostgres({ port: PORT, forceEmbedded: true });
  url = postgres.url;
  await runMigrations(url);
});

after(async () => {
  await postgres.stop();
});

test("apply encrypts Kick token using existing helper and does not credit promo wallet txs", async () => {
  const store = storeFromObject(
    withKick(
      fixtureStore({
        promoCodes: {
          HELLO: { code: "HELLO", reward: 100, maxUses: 10, usedCount: 1, active: true },
        },
        promoUsages: {
          "HELLO:1001": {
            code: "HELLO",
            userId: 1001,
            reward: 100,
            usedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }),
    ),
  );
  const audit = { store, storePath: "memory://apply" };
  const report = await auditV1Store(audit);
  assert.equal(report.blockingIssues.length, 0);
  await applyV1Cutover({
    audit,
    flags: {
      apply: true,
      confirmApply: true,
      confirmSourceSha256: store.sha256,
      confirmReportSha256: hashCanonicalReport(report),
      productionConfirm: false,
      databaseUrl: url,
      kickTokenEncryptionKey: KEY,
    },
  });
  const handle = createDb(url);
  try {
    const rows = await handle.db.select().from(kickAccounts);
    assert.equal(rows.length, 1);
    const enc = rows[0]?.accessTokenEncrypted;
    assert.ok(enc);
    assert.ok(!enc.includes("PLAINTEXT_ACCESS"));
    const plain = decryptSecret(parseTokenEncryptionKey(KEY), enc);
    assert.equal(plain, "PLAINTEXT_ACCESS");

    const levels = await handle.db.select().from(userLevelRewards);
    assert.equal(levels.some((r) => r.reachedLevel === 71), false);
    assert.equal(levels.some((r) => r.reachedLevel === 1), false);
    assert.equal(levels.some((r) => r.reachedLevel === 2), true);

    const txs = await handle.db.select().from(walletTransactions);
    assert.equal(txs.length, 0);

    const identities = await handle.db.select().from(v1ImportIdentities);
    assert.equal(identities.length, 2);
    const alice = identities.find((row) => String(row.telegramUserId) === "1001");
    assert.ok(alice);
    const grants = await grantLevelRewards(handle.db, {
      userId: alice.userId,
      previousLevel: 1,
      newLevel: 2,
    });
    assert.equal(grants.length, 0);
    const txsAfter = await handle.db.select().from(walletTransactions);
    assert.equal(txsAfter.length, 0);
  } finally {
    await handle.sql.end({ timeout: 5 });
  }

  const again = await applyV1Cutover({
    audit,
    flags: {
      apply: true,
      confirmApply: true,
      confirmSourceSha256: store.sha256,
      confirmReportSha256: hashCanonicalReport(report),
      productionConfirm: false,
      databaseUrl: url,
      kickTokenEncryptionKey: KEY,
    },
  });
  assert.equal(again.applied, true);
  const handle2 = createDb(url);
  try {
    const identities = await handle2.db.select().from(v1ImportIdentities);
    assert.equal(identities.length, 2);
  } finally {
    await handle2.sql.end({ timeout: 5 });
  }
});
