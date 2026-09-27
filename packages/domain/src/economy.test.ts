import {
  caseRewardItems,
  cases,
  games,
  products,
  taskRequirements,
  tasks,
} from "@giftbot/db/schema";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { settleFromCatalog } from "./catalog.js";
import {
  completeTask,
  openCase,
  payoutReferralReward,
  purchaseProduct,
} from "./economy.js";
import { playCatalogGame, readGameRound, settleAsyncRound } from "./game.js";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import { provisionUser } from "./user.js";
import { apply, reconcileWallet } from "./wallet.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

test("catalog settle uses stored prizeMinor and never a client result", () => {
  const settled = settleFromCatalog({
    betAmountMinor: 5n,
    drawValue: 9n,
    config: { prizeMinor: "3", allowedBetMinor: ["5"] },
  });
  assert.deepEqual(settled.resultPayload, { draw: "9" });
  assert.equal(settled.prizeMinor, 3n);
  assert.equal(
    settleFromCatalog({
      betAmountMinor: 5n,
      drawValue: 1n,
      config: {},
    }).prizeMinor,
    0n,
  );
});

test("catalog instant play is idempotent and client cannot set the result", async () => {
  const user = await provisionUser(harness.db);
  await apply(harness.db, {
    userId: user.userId,
    type: "deposit",
    amountMinor: 20n,
    idempotencyKey: `deposit:${user.userId}:play`,
    actorType: "system",
  });
  const [game] = await harness.db
    .insert(games)
    .values({
      slug: `play-${user.userId.slice(0, 8)}`,
      title: "catalog instant",
      settlementMode: "instant",
      status: "active",
      config: { allowedBetMinor: ["5"], prizeMinor: "2" },
    })
    .returning();
  assert.ok(game);

  await assert.rejects(
    () =>
      playCatalogGame(harness.db, {
        gameId: game.id,
        userId: user.userId,
        betAmountMinor: 7n,
        idempotencyKey: `round:${user.userId}:bad-bet`,
      }),
    /not allowed|not configured/,
  );

  const played = await playCatalogGame(harness.db, {
    gameId: game.id,
    userId: user.userId,
    betAmountMinor: 5n,
    idempotencyKey: `round:${user.userId}:play`,
    betPayload: { result: "client-win", prizeMinor: "999" },
  });
  assert.equal(played.status, "settled");
  assert.equal(played.resultPayload?.draw !== "client-win", true);
  assert.notEqual(played.prizeTx?.transaction.amountMinor, 999n);

  const replay = await playCatalogGame(harness.db, {
    gameId: game.id,
    userId: user.userId,
    betAmountMinor: 5n,
    idempotencyKey: `round:${user.userId}:play`,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.roundId, played.roundId);

  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 17n);
  assert.equal(report.consistent, true);
});

test("readGameRound does not settle an async round", async () => {
  const user = await provisionUser(harness.db);
  await apply(harness.db, {
    userId: user.userId,
    type: "deposit",
    amountMinor: 10n,
    idempotencyKey: `deposit:${user.userId}:async-read`,
    actorType: "system",
  });
  const [game] = await harness.db
    .insert(games)
    .values({
      slug: `async-read-${user.userId.slice(0, 8)}`,
      title: "catalog async",
      settlementMode: "async",
      status: "active",
      config: { allowedBetMinor: ["4"], prizeMinor: "1" },
    })
    .returning();
  assert.ok(game);
  const accepted = await playCatalogGame(harness.db, {
    gameId: game.id,
    userId: user.userId,
    betAmountMinor: 4n,
    idempotencyKey: `round:${user.userId}:async-read`,
  });
  const viewed = await readGameRound(harness.db, {
    roundId: accepted.roundId,
    userId: user.userId,
  });
  assert.equal(viewed.status, "pending");
  assert.equal(viewed.resultPayload, undefined);
  const afterRead = await reconcileWallet(harness.db, user.userId);
  assert.equal(afterRead.balanceMinor, 6n);

  const settled = await settleAsyncRound(harness.db, {
    roundId: accepted.roundId,
    settle: settleFromCatalog,
  });
  assert.equal(settled.status, "settled");
  const afterSettle = await reconcileWallet(harness.db, user.userId);
  assert.equal(afterSettle.balanceMinor, 7n);
});

test("case open uses catalog price and item weights", async () => {
  const user = await provisionUser(harness.db);
  await apply(harness.db, {
    userId: user.userId,
    type: "deposit",
    amountMinor: 15n,
    idempotencyKey: `deposit:${user.userId}:case`,
    actorType: "system",
  });
  const [box] = await harness.db
    .insert(cases)
    .values({
      slug: `case-${user.userId.slice(0, 8)}`,
      title: "catalog case",
      priceMinor: 6n,
      status: "active",
    })
    .returning();
  assert.ok(box);
  await harness.db.insert(caseRewardItems).values({
    caseId: box.id,
    title: "only",
    weight: 1,
    rewardMinor: 2n,
  });

  const opened = await openCase(harness.db, {
    userId: user.userId,
    caseId: box.id,
    idempotencyKey: `case:${user.userId}:open`,
  });
  assert.equal(opened.status, "settled");
  const replay = await openCase(harness.db, {
    userId: user.userId,
    caseId: box.id,
    idempotencyKey: `case:${user.userId}:open`,
  });
  assert.equal(replay.replayed, true);
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 11n);
});

test("case without price or rewards is rejected", async () => {
  const user = await provisionUser(harness.db);
  const [box] = await harness.db
    .insert(cases)
    .values({
      slug: `empty-${user.userId.slice(0, 8)}`,
      title: "empty case",
      status: "active",
    })
    .returning();
  assert.ok(box);
  await assert.rejects(
    () =>
      openCase(harness.db, {
        userId: user.userId,
        caseId: box.id,
        idempotencyKey: `case:${user.userId}:empty`,
      }),
    /not configured/,
  );
});

test("shop purchase uses catalog price and is idempotent", async () => {
  const user = await provisionUser(harness.db);
  await apply(harness.db, {
    userId: user.userId,
    type: "deposit",
    amountMinor: 12n,
    idempotencyKey: `deposit:${user.userId}:shop`,
    actorType: "system",
  });
  const [product] = await harness.db
    .insert(products)
    .values({
      slug: `sku-${user.userId.slice(0, 8)}`,
      type: "internal",
      priceMinor: 4n,
      status: "active",
    })
    .returning();
  assert.ok(product);
  const bought = await purchaseProduct(harness.db, {
    userId: user.userId,
    productId: product.id,
    idempotencyKey: `buy:${user.userId}`,
  });
  assert.equal(bought.status, "delivered");
  const replay = await purchaseProduct(harness.db, {
    userId: user.userId,
    productId: product.id,
    idempotencyKey: `buy:${user.userId}`,
  });
  assert.equal(replay.replayed, true);
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 8n);
});

test("task with requirements is not completed or paid", async () => {
  const user = await provisionUser(harness.db);
  const [task] = await harness.db
    .insert(tasks)
    .values({
      slug: `req-${user.userId.slice(0, 8)}`,
      title: "blocked task",
      status: "active",
      rewardMinor: 50n,
    })
    .returning();
  assert.ok(task);
  await harness.db.insert(taskRequirements).values({
    taskId: task.id,
    type: "kick.watch",
    config: {},
  });
  await assert.rejects(
    () =>
      completeTask(harness.db, {
        userId: user.userId,
        taskId: task.id,
        idempotencyKey: `task:${user.userId}:req`,
      }),
    /not enabled/,
  );
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 0n);
});

test("task without requirements pays only catalog rewardMinor", async () => {
  const user = await provisionUser(harness.db);
  const [task] = await harness.db
    .insert(tasks)
    .values({
      slug: `pay-${user.userId.slice(0, 8)}`,
      title: "catalog task",
      status: "active",
      rewardMinor: 3n,
    })
    .returning();
  assert.ok(task);
  const done = await completeTask(harness.db, {
    userId: user.userId,
    taskId: task.id,
    idempotencyKey: `task:${user.userId}:pay`,
  });
  assert.equal(done.status, "rewarded");
  const replay = await completeTask(harness.db, {
    userId: user.userId,
    taskId: task.id,
    idempotencyKey: `task:${user.userId}:other-key`,
  });
  assert.equal(replay.replayed, true);
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 3n);
});

test("referral payout stays disabled", async () => {
  await assert.rejects(
    () => payoutReferralReward(),
    /activateReferralIfEligible/,
  );
});
