import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import {
  kickAccounts,
  telegramAccounts,
  walletTransactions,
  wallets,
} from "@giftbot/db/schema";
import { apply, identifyTelegramUser, linkKickAccount } from "@giftbot/domain";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { DevPostgres } from "@giftbot/db";
import { runAvatarBackfill } from "./backfill.js";
import { storeFromObject } from "./store.js";

const PORT = 55494;

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

test("dry-run writes nothing; apply updates only avatars and is idempotent", async () => {
  const handle = createDb(url);
  try {
    const identity = await identifyTelegramUser(handle.db, {
      telegramUserId: 7001n,
      firstName: "Backfill",
    });
    await linkKickAccount(handle.db, {
      userId: identity.userId,
      kickUserId: "kick-7001",
    });
    await apply(handle.db, {
      userId: identity.userId,
      type: "admin_adjustment",
      amountMinor: 250n,
      idempotencyKey: "avatar-backfill-credit",
      actorType: "admin",
      reason: "fixture",
    });
    const walletBefore = (
      await handle.db.select().from(wallets).where(eq(wallets.userId, identity.userId))
    )[0];
    const txBefore = (
      await handle.db
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.userId, identity.userId))
    ).length;
    assert.equal(walletBefore?.balanceMinor, 250n);

    const store = storeFromObject({
      users: {
        "7001": {
          telegramId: 7001,
          photoUrl: "https://cdn.telegram.org/v1.jpg",
          kickUserId: "kick-7001",
          kickAvatarUrl: "https://images.kick.com/v1.png",
        },
        "missing": { telegramId: 999999, photoUrl: "https://cdn.telegram.org/x.jpg" },
      },
      kickAccounts: {
        "kick-7001": { avatarUrl: "https://images.kick.com/v1.png" },
      },
    });

    const dry = await runAvatarBackfill({
      store,
      flags: { apply: false, confirmApply: false, databaseUrl: url },
    });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.counts.telegramMatched, 1);
    assert.equal(dry.counts.telegramAvatarAvailable, 1);
    assert.equal(dry.counts.telegramUpdated, 1);
    assert.equal(dry.counts.kickMatched, 1);
    assert.equal(dry.counts.kickAvatarAvailable, 1);
    assert.equal(dry.counts.kickUpdated, 1);
    assert.equal(dry.counts.missingIdentities, 1);

    const afterDryTg = (
      await handle.db
        .select()
        .from(telegramAccounts)
        .where(eq(telegramAccounts.userId, identity.userId))
    )[0];
    assert.equal(afterDryTg?.photoUrl, null);
    const afterDryKick = (
      await handle.db
        .select()
        .from(kickAccounts)
        .where(eq(kickAccounts.userId, identity.userId))
    )[0];
    assert.equal(afterDryKick?.avatarUrl, null);

    await assert.rejects(
      () =>
        runAvatarBackfill({
          store,
          flags: { apply: true, confirmApply: false, databaseUrl: url },
        }),
      /confirm-apply/,
    );

    const applied = await runAvatarBackfill({
      store,
      flags: { apply: true, confirmApply: true, databaseUrl: url },
    });
    assert.equal(applied.dryRun, false);
    assert.equal(applied.counts.telegramUpdated, 1);
    assert.equal(applied.counts.kickUpdated, 1);

    const afterApplyTg = (
      await handle.db
        .select()
        .from(telegramAccounts)
        .where(eq(telegramAccounts.userId, identity.userId))
    )[0];
    assert.equal(afterApplyTg?.photoUrl, "https://cdn.telegram.org/v1.jpg");
    const afterApplyKick = (
      await handle.db
        .select()
        .from(kickAccounts)
        .where(eq(kickAccounts.userId, identity.userId))
    )[0];
    assert.equal(afterApplyKick?.avatarUrl, "https://images.kick.com/v1.png");
    assert.equal(afterApplyKick?.accessTokenEncrypted, null);

    const rerun = await runAvatarBackfill({
      store,
      flags: { apply: true, confirmApply: true, databaseUrl: url },
    });
    assert.equal(rerun.counts.telegramUpdated, 0);
    assert.equal(rerun.counts.kickUpdated, 0);

    const walletAfter = (
      await handle.db.select().from(wallets).where(eq(wallets.userId, identity.userId))
    )[0];
    assert.equal(walletAfter?.balanceMinor, 250n);
    const txAfter = (
      await handle.db
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.userId, identity.userId))
    ).length;
    assert.equal(txAfter, txBefore);
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
});
