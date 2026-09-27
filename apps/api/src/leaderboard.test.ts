import {
  buildSignedInitData,
  createAuthPolicy,
} from "@giftbot/auth";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import { apply } from "@giftbot/domain";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApiApp } from "./app.js";

const botToken = "123456:TEST-BOT-TOKEN-LEADERBOARD";
const policy = createAuthPolicy(botToken);

let postgres: DevPostgres;
let sqlEnd: () => Promise<void>;
let db: ReturnType<typeof createDb>["db"];

before(async () => {
  postgres = await startDevPostgres({ port: 55481 });
  await runMigrations(postgres.url);
  const handle = createDb(postgres.url);
  db = handle.db;
  sqlEnd = async () => {
    await handle.sql.end({ timeout: 5 });
  };
});

after(async () => {
  await sqlEnd();
  await postgres.stop();
});

async function miniToken(
  telegramUserId: number,
  username?: string,
): Promise<{ token: string; userId: string }> {
  const app = createApiApp({ db, authPolicy: policy, allowDevAuth: true });
  const created = await app.inject({
    method: "POST",
    url: "/auth/telegram",
    payload: {
      initData: buildSignedInitData(
        botToken,
        {
          id: telegramUserId,
          first_name: "Lb",
          ...(username ? { username } : {}),
        },
        Math.floor(Date.now() / 1000),
      ),
    },
  });
  const body = created.json() as { token: string; user: { userId: string } };
  await app.close();
  return { token: body.token, userId: body.user.userId };
}

test("GET /leaderboard/balance returns TOP ranks without private ids", async () => {
  const rich = await miniToken(99101, "rich_lb");
  const poor = await miniToken(99102, "poor_lb");
  await apply(db, {
    userId: rich.userId,
    type: "admin_adjustment",
    amountMinor: 77_777n,
    idempotencyKey: `api-lb-rich-${rich.userId}`,
    actorType: "admin",
    reason: "seed",
  });
  await apply(db, {
    userId: poor.userId,
    type: "admin_adjustment",
    amountMinor: 11n,
    idempotencyKey: `api-lb-poor-${poor.userId}`,
    actorType: "admin",
    reason: "seed",
  });

  const app = createApiApp({ db, authPolicy: policy });
  const board = await app.inject({
    method: "GET",
    url: "/leaderboard/balance",
    headers: { authorization: `Bearer ${poor.token}` },
  });
  assert.equal(board.statusCode, 200);
  const body = board.json() as {
    items: Array<Record<string, unknown>>;
    self: Record<string, unknown> | null;
    serverTime: string;
  };
  assert.ok(Array.isArray(body.items));
  assert.ok(body.self);
  assert.equal(body.self?.isYou, true);
  assert.equal(body.self?.balanceAzc, "11");
  assert.ok(typeof body.serverTime === "string");
  const blob = JSON.stringify(body);
  assert.doesNotMatch(blob, /telegramId|session|kickToken|walletId|"role"/i);
  assert.doesNotMatch(blob, /"userId"/);
  await app.close();
});

test("GET /leaderboard/balance is read-only for balances", async () => {
  const mini = await miniToken(99103, "readonly_lb");
  await apply(db, {
    userId: mini.userId,
    type: "admin_adjustment",
    amountMinor: 42n,
    idempotencyKey: `api-lb-ro-${mini.userId}`,
    actorType: "admin",
    reason: "seed",
  });
  const app = createApiApp({ db, authPolicy: policy });
  const before = await app.inject({
    method: "GET",
    url: "/leaderboard/balance",
    headers: { authorization: `Bearer ${mini.token}` },
  });
  const after = await app.inject({
    method: "GET",
    url: "/leaderboard/balance",
    headers: { authorization: `Bearer ${mini.token}` },
  });
  assert.equal(before.statusCode, 200);
  assert.equal(after.statusCode, 200);
  const a = before.json() as { self: { balanceAzc: string; rank: number } };
  const b = after.json() as { self: { balanceAzc: string; rank: number } };
  assert.equal(a.self.balanceAzc, b.self.balanceAzc);
  assert.equal(a.self.rank, b.self.rank);
  await app.close();
});
