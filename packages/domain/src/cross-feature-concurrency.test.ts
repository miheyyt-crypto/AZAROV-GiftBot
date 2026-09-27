import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import { playDice } from "./dice.js";
import { startMinesGame } from "./mines.js";
import { ensureCurrentRollsRound, placeRollsBet } from "./rolls.js";
import { createShopOrder, ensureShopCatalog } from "./shop.js";
import { apply, reconcileWallet } from "./wallet.js";
import { provisionUser } from "./user.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
  await ensureShopCatalog(harness.db);
});

after(async () => {
  await harness.stop();
});

test("cross-feature concurrent spends cannot drive AZC negative", async () => {
  const user = await provisionUser(harness.db, { displayName: "CrossSpend" });
  // Seed covers at most one of the concurrent 1000 AZC spends.
  await apply(harness.db, {
    userId: user.userId,
    type: "deposit",
    amountMinor: 1_200n,
    idempotencyKey: `cross-fund-${user.userId}`,
    actorType: "system",
  });

  await ensureCurrentRollsRound(harness.db);

  const results = await Promise.allSettled([
    createShopOrder(harness.db, {
      userId: user.userId,
      productCode: "streak-freeze",
      submittedData: {},
      idempotencyKey: `cross-shop-${user.userId}`,
    }),
    playDice(harness.db, {
      userId: user.userId,
      betAzc: 1000,
      chance: 50,
      clientSeed: `cross-dice-${user.userId}`,
      idempotencyKey: `cross-dice-${user.userId}`,
    }),
    startMinesGame(harness.db, {
      userId: user.userId,
      betAzc: 1000,
      mines: 3,
      clientSeed: `cross-mines-${user.userId}`,
      idempotencyKey: `cross-mines-${user.userId}`,
    }),
    placeRollsBet(harness.db, {
      userId: user.userId,
      amountAzc: 1000,
      clientSeed: `cross-rolls-${user.userId}`,
      idempotencyKey: `cross-rolls-${user.userId}`,
    }),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.ok(fulfilled.length >= 1);
  assert.ok(rejected.length >= 1);
  assert.equal(fulfilled.length + rejected.length, 4);

  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.consistent, true);
  assert.ok(report.balanceMinor >= 0n);
  assert.ok(report.balanceMinor <= 1_200n);
});
