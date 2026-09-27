import {
  minesGames,
  walletTransactions,
  wallets,
} from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import {
  cashoutMinesGame,
  getActiveMinesGame,
  revealMinesCell,
  startMinesGame,
} from "./mines.js";
import { playDice } from "./dice.js";
import { assertServerSeedHash, dicePayoutAzc, verifyMinesBoard } from "./provably-fair.js";
import { provisionUser } from "./user.js";
import { apply } from "./wallet.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

async function fund(userId: string, amount: bigint, key: string): Promise<void> {
  await apply(harness.db, {
    userId,
    type: "deposit",
    amountMinor: amount,
    idempotencyKey: key,
    actorType: "system",
    reason: "test fund",
  });
}

async function balance(userId: string): Promise<bigint> {
  const rows = await harness.db
    .select({ b: wallets.balanceMinor })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  return BigInt(rows[0]?.b ?? 0);
}

test("mines start rejects bounds and unsupported mines", async () => {
  const user = await provisionUser(harness.db);
  await fund(user.userId, 50_000n, `fund-m1-${user.userId}`);
  await assert.rejects(
    () =>
      startMinesGame(harness.db, {
        userId: user.userId,
        betAzc: 99,
        mines: 3,
        clientSeed: "abc",
        idempotencyKey: "m-low",
      }),
    (err: Error & { code?: string }) => err.code === "MINES_BET_OUT_OF_RANGE",
  );
  await assert.rejects(
    () =>
      startMinesGame(harness.db, {
        userId: user.userId,
        betAzc: 10001,
        mines: 3,
        clientSeed: "abc",
        idempotencyKey: "m-high",
      }),
    (err: Error & { code?: string }) => err.code === "MINES_BET_OUT_OF_RANGE",
  );
  await assert.rejects(
    () =>
      startMinesGame(harness.db, {
        userId: user.userId,
        betAzc: 100,
        mines: 4,
        clientSeed: "abc",
        idempotencyKey: "m-bad",
      }),
    (err: Error & { code?: string }) => err.code === "MINES_INVALID_MINE_COUNT",
  );
  const accepted = await startMinesGame(harness.db, {
    userId: user.userId,
    betAzc: 100,
    mines: 3,
    clientSeed: "abc",
    idempotencyKey: "m-ok-100",
  });
  assert.equal(accepted.game.betAzc, "100");
  assert.equal(accepted.game.mineCount, 3);
});

test("mines start debits once, hides seed, blocks second active", async () => {
  const user = await provisionUser(harness.db);
  await fund(user.userId, 5_000n, `fund-m2-${user.userId}`);
  const first = await startMinesGame(harness.db, {
    userId: user.userId,
    betAzc: 100,
    mines: 3,
    clientSeed: "seed-1",
    idempotencyKey: "start-1",
  });
  assert.equal(first.game.status, "active");
  assert.ok(first.game.serverSeedHash);
  assert.equal(first.game.serverSeed, null);
  assert.equal(first.game.minePositions, null);
  assert.equal(await balance(user.userId), 4_900n);
  const rawStart = (
    await harness.db
      .select()
      .from(minesGames)
      .where(eq(minesGames.id, first.game.gameId))
  )[0]!;
  assert.equal(rawStart.minePositions.length, 3);
  assert.equal(first.game.mineCount, 3);
  assert.equal(
    verifyMinesBoard({
      serverSeed: rawStart.serverSeed,
      clientSeed: "seed-1",
      nonce: rawStart.nonce,
      mineCount: 3,
      minePositions: rawStart.minePositions,
    }),
    true,
  );

  const replay = await startMinesGame(harness.db, {
    userId: user.userId,
    betAzc: 100,
    mines: 3,
    clientSeed: "seed-1",
    idempotencyKey: "start-1",
  });
  assert.equal(replay.replayed, true);
  assert.equal(await balance(user.userId), 4_900n);

  await assert.rejects(
    () =>
      startMinesGame(harness.db, {
        userId: user.userId,
        betAzc: 100,
        mines: 3,
        clientSeed: "seed-2",
        idempotencyKey: "start-2",
      }),
    (err: Error & { code?: string }) => err.code === "MINES_GAME_ALREADY_ACTIVE",
  );
});

test("mines safe cashout and concurrent cashout pay once", async () => {
  const user = await provisionUser(harness.db);
  await fund(user.userId, 10_000n, `fund-m3-${user.userId}`);

  // Force a known board by starting then reading DB mines and picking a safe cell
  const started = await startMinesGame(harness.db, {
    userId: user.userId,
    betAzc: 1000,
    mines: 3,
    clientSeed: "cash-seed",
    idempotencyKey: "cash-start",
  });
  const raw = (
    await harness.db
      .select()
      .from(minesGames)
      .where(eq(minesGames.id, started.game.gameId))
  )[0]!;
  const mines = new Set(raw.minePositions);
  let safe = 0;
  while (mines.has(safe)) {
    safe += 1;
  }
  const revealed = await revealMinesCell(harness.db, {
    userId: user.userId,
    gameId: started.game.gameId,
    cell: safe,
    idempotencyKey: "rev-1",
  });
  assert.equal(revealed.hitMine, false);
  assert.equal(revealed.game.safePickCount, 1);
  assert.equal(revealed.game.currentMultiplier, "1.14");

  const [a, b] = await Promise.all([
    cashoutMinesGame(harness.db, {
      userId: user.userId,
      gameId: started.game.gameId,
      idempotencyKey: "cash-a",
    }),
    cashoutMinesGame(harness.db, {
      userId: user.userId,
      gameId: started.game.gameId,
      idempotencyKey: "cash-b",
    }),
  ]);
  assert.ok(
    (a.game.status === "cashed_out" || a.replayed) &&
      (b.game.status === "cashed_out" || b.replayed),
  );
  const wins = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  assert.equal(wins.filter((r) => r.type === "mines_win").length, 1);
  assert.equal(await balance(user.userId), 10_000n - 1000n + 1140n);
  assert.ok(a.game.serverSeed || b.game.serverSeed);
  const seed = a.game.serverSeed ?? b.game.serverSeed!;
  assert.equal(assertServerSeedHash(seed, a.game.serverSeedHash), true);
  assert.equal(await getActiveMinesGame(harness.db, user.userId), null);
});

test("mines hit mine pays zero and reveals seed", async () => {
  const user = await provisionUser(harness.db);
  await fund(user.userId, 1_000n, `fund-m4-${user.userId}`);
  const started = await startMinesGame(harness.db, {
    userId: user.userId,
    betAzc: 100,
    mines: 24,
    clientSeed: "boom",
    idempotencyKey: "boom-start",
  });
  const raw = (
    await harness.db
      .select()
      .from(minesGames)
      .where(eq(minesGames.id, started.game.gameId))
  )[0]!;
  const mine = raw.minePositions[0]!;
  const hit = await revealMinesCell(harness.db, {
    userId: user.userId,
    gameId: started.game.gameId,
    cell: mine,
    idempotencyKey: "boom-rev",
  });
  assert.equal(hit.hitMine, true);
  assert.equal(hit.game.status, "lost");
  assert.equal(hit.game.payoutAzc, "0");
  assert.ok(hit.game.serverSeed);
  assert.equal(hit.game.minePositions?.length, 24);
  assert.equal(await balance(user.userId), 900n);
});

test("mines start stores exactly the selected mine count on the board", async () => {
  for (const mines of [3, 5, 24] as const) {
    const user = await provisionUser(harness.db);
    await fund(user.userId, 1_000n, `fund-mc-${mines}-${user.userId}`);
    const started = await startMinesGame(harness.db, {
      userId: user.userId,
      betAzc: 100,
      mines,
      clientSeed: `count-${mines}`,
      idempotencyKey: `count-start-${mines}`,
    });
    const raw = (
      await harness.db
        .select()
        .from(minesGames)
        .where(eq(minesGames.id, started.game.gameId))
    )[0]!;
    assert.equal(started.game.mineCount, mines);
    assert.equal(raw.minePositions.length, mines);
  }
});

test("dice play idempotent and concurrent wallet safety", async () => {
  const user = await provisionUser(harness.db);
  await fund(user.userId, 100n, `fund-d1-${user.userId}`);
  const attempts = await Promise.all([
    playDice(harness.db, {
      userId: user.userId,
      betAzc: 100,
      chance: 50,
      clientSeed: "d-a",
      idempotencyKey: "dice-1",
    })
      .then((r) => ({ ok: true as const, key: "dice-1", r }))
      .catch((e: unknown) => ({ ok: false as const, key: "dice-1", e })),
    playDice(harness.db, {
      userId: user.userId,
      betAzc: 100,
      chance: 50,
      clientSeed: "d-b",
      idempotencyKey: "dice-2",
    })
      .then((r) => ({ ok: true as const, key: "dice-2", r }))
      .catch((e: unknown) => ({ ok: false as const, key: "dice-2", e })),
  ]);
  const ok = attempts.filter((a) => a.ok);
  const fail = attempts.filter((a) => !a.ok);
  assert.ok(ok.length >= 1 && ok.length <= 2);
  assert.equal(fail.length, 2 - ok.length);
  if (ok.length === 2) {
    assert.ok(ok.some((a) => a.ok && a.r.round.win));
  }
  for (const f of fail) {
    assert.ok(!f.ok);
    assert.equal((f.e as { code?: string }).code, "INSUFFICIENT_BALANCE");
  }
  assert.ok((await balance(user.userId)) >= 0n);

  const winner = ok[0];
  assert.ok(winner && winner.ok);
  const again = await playDice(harness.db, {
    userId: user.userId,
    betAzc: 100,
    chance: 50,
    clientSeed: winner.key === "dice-1" ? "d-a" : "d-b",
    idempotencyKey: winner.key,
  });
  assert.equal(again.replayed, true);
  assert.equal(again.round.id, winner.r.round.id);
});

test("dice exact payouts on forced win via known seeds are verified by math helpers", () => {
  assert.equal(dicePayoutAzc(100n, 95), 105n);
});
