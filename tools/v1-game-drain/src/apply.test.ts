import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyDrainFile, applyPlanToStore } from "./apply.js";
import { toDrainReport, walletSum } from "./audit.js";
import { drainFixture } from "./fixtures.js";

test("apply refunds start-state mines/tower and cashouts progressed games; rerun is idempotent", () => {
  const store = drainFixture({
    users: {
      "1": { telegramId: 1, balance: 900 },
      "2": { telegramId: 2, balance: 1900 },
      "3": { telegramId: 3, balance: 500 },
    },
    minesGames: {
      m0: {
        status: "playing",
        bet: 100,
        mineCount: 5,
        gridSize: 25,
        revealed: [],
        userId: 1,
      },
      m1: {
        status: "playing",
        bet: 100,
        mineCount: 5,
        gridSize: 25,
        revealed: [3],
        userId: 2,
      },
      lost: { status: "lost", bet: 100, mineCount: 5, revealed: [], userId: 1 },
    },
    towerGames: {
      t0: { status: "playing", bet: 100, floorsCleared: 0, userId: 1 },
      t1: { status: "playing", bet: 100, floorsCleared: 1, userId: 3 },
    },
    rollRounds: {
      empty: { status: "waiting", players: [], pot: 0 },
    },
  });
  const before = toDrainReport("memory://a", "x", store, "audit");
  const unrelated = 500;
  assert.equal((store.users as Record<string, { balance: number }>)["3"]?.balance, unrelated);
  applyPlanToStore(store);
  const users = store.users as Record<string, { balance: number }>;
  assert.equal(users["1"]?.balance, 900 + 100 + 100);
  assert.equal(users["2"]?.balance, 1900 + 121);
  assert.equal(users["3"]?.balance, 500 + 100);
  assert.equal(walletSum(users), before.expectedFinalWalletSum);
  const mines = store.minesGames as Record<string, { status: string }>;
  assert.equal(mines.m0?.status, "cancelled");
  assert.equal(mines.m1?.status, "won");
  assert.equal(mines.lost?.status, "lost");
  JSON.parse(JSON.stringify(store));

  const mid = users["1"]?.balance;
  applyPlanToStore(store);
  assert.equal(users["1"]?.balance, mid);
  const after = toDrainReport("memory://b", "y", store, "audit");
  assert.equal(after.financiallyBlocking, 0);
});

test("rolls with bet refunds only that user", () => {
  const store = drainFixture({
    users: {
      "1": { telegramId: 1, balance: 50 },
      "2": { telegramId: 2, balance: 999 },
    },
    rollRounds: {
      r: {
        status: "waiting",
        players: [{ userId: 1, bet: 250 }],
        pot: 250,
      },
    },
  });
  applyPlanToStore(store);
  const users = store.users as Record<string, { balance: number }>;
  assert.equal(users["1"]?.balance, 300);
  assert.equal(users["2"]?.balance, 999);
  const round = (store.rollRounds as Record<string, { status: string }>).r;
  assert.equal(round?.status, "cancelled");
});

test("file apply is idempotent and refuses without offline/backup flags", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drain-"));
  const storePath = join(dir, "store.json");
  const backupPath = join(dir, "backup.json");
  const raw = drainFixture({
    users: { "1": { telegramId: 1, balance: 0 } },
    minesGames: {
      m: {
        status: "playing",
        bet: 100,
        mineCount: 5,
        gridSize: 25,
        revealed: [],
        userId: 1,
      },
    },
  });
  const body = `${JSON.stringify(raw)}\n`;
  await writeFile(storePath, body);
  await writeFile(backupPath, body);
  const { createHash } = await import("node:crypto");
  const sha = createHash("sha256").update(body).digest("hex");
  await assert.rejects(() =>
    applyDrainFile(storePath, {
      apply: true,
      confirmDrain: true,
      confirmOffline: false,
      confirmSourceSha256: sha,
      backupPath,
      confirmBackupSha256: sha,
    }),
  );
  const first = await applyDrainFile(storePath, {
    apply: true,
    confirmDrain: true,
    confirmOffline: true,
    confirmSourceSha256: sha,
    backupPath,
    confirmBackupSha256: sha,
  });
  assert.equal(first.applied, true);
  const parsed = JSON.parse(await readFile(storePath, "utf8")) as {
    users: Record<string, { balance: number }>;
  };
  assert.equal(parsed.users["1"]?.balance, 100);
  JSON.parse(await readFile(storePath, "utf8"));
});
