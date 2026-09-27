import { games } from "@giftbot/db/schema";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { acceptAsyncBet, acceptInstantGame, settleAsyncRound } from "./game.js";
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

test("instant game settles in one transaction and is idempotent", async () => {
  const user = await provisionUser(harness.db);
  await apply(harness.db, {
    userId: user.userId,
    type: "deposit",
    amountMinor: 30n,
    idempotencyKey: `deposit:${user.userId}:instant`,
    actorType: "system",
  });

  const [game] = await harness.db
    .insert(games)
    .values({
      slug: `instant-${user.userId.slice(0, 8)}`,
      title: "instant harness",
      settlementMode: "instant",
      status: "active",
      config: {},
    })
    .returning();
  assert.ok(game);

  const played = await acceptInstantGame(harness.db, {
    gameId: game.id,
    userId: user.userId,
    betAmountMinor: 10n,
    idempotencyKey: `round:${user.userId}:instant`,
    settle: ({ drawValue }) => ({
      resultPayload: { draw: drawValue.toString() },
      prizeMinor: 4n,
    }),
  });
  assert.equal(played.status, "settled");
  assert.equal(played.replayed, false);
  assert.ok(played.resultPayload);

  const replay = await acceptInstantGame(harness.db, {
    gameId: game.id,
    userId: user.userId,
    betAmountMinor: 10n,
    idempotencyKey: `round:${user.userId}:instant`,
    settle: () => ({
      resultPayload: { draw: "should-not-run" },
      prizeMinor: 999n,
    }),
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.roundId, played.roundId);

  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 24n);
  assert.equal(report.consistent, true);
});

test("async game bet and settlement are separate and idempotent", async () => {
  const user = await provisionUser(harness.db);
  await apply(harness.db, {
    userId: user.userId,
    type: "deposit",
    amountMinor: 20n,
    idempotencyKey: `deposit:${user.userId}:async`,
    actorType: "system",
  });

  const [game] = await harness.db
    .insert(games)
    .values({
      slug: `async-${user.userId.slice(0, 8)}`,
      title: "async harness",
      settlementMode: "async",
      status: "active",
      config: {},
    })
    .returning();
  assert.ok(game);

  const accepted = await acceptAsyncBet(harness.db, {
    gameId: game.id,
    userId: user.userId,
    betAmountMinor: 8n,
    idempotencyKey: `round:${user.userId}:async`,
  });
  assert.equal(accepted.status, "pending");
  const afterBet = await reconcileWallet(harness.db, user.userId);
  assert.equal(afterBet.balanceMinor, 12n);

  const settled = await settleAsyncRound(harness.db, {
    roundId: accepted.roundId,
    settle: ({ drawValue }) => ({
      resultPayload: { draw: drawValue.toString() },
      prizeMinor: 3n,
    }),
  });
  assert.equal(settled.status, "settled");
  assert.equal(settled.replayed, false);

  const settledAgain = await settleAsyncRound(harness.db, {
    roundId: accepted.roundId,
    settle: () => ({
      resultPayload: { draw: "nope" },
      prizeMinor: 50n,
    }),
  });
  assert.equal(settledAgain.replayed, true);

  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 15n);
  assert.equal(report.consistent, true);
});
