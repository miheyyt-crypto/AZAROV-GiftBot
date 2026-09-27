import {
  buildSignedInitData,
  createAuthPolicy,
} from "@giftbot/auth";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import { freeCaseOpenings, walletTransactions } from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApiApp } from "./app.js";

const botToken = "123456:TEST-BOT-TOKEN-FREE-CASE";
const policy = createAuthPolicy(botToken);

let postgres: DevPostgres;
let sqlEnd: () => Promise<void>;
let db: ReturnType<typeof createDb>["db"];

before(async () => {
  postgres = await startDevPostgres({ port: 55470 });
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

function signedInitData(telegramUserId: number): string {
  return buildSignedInitData(
    botToken,
    { id: telegramUserId, first_name: "Free", username: `u${telegramUserId}` },
    Math.floor(Date.now() / 1000),
  );
}

async function miniToken(telegramUserId: number): Promise<{
  token: string;
  userId: string;
}> {
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: "/auth/telegram",
    payload: { initData: signedInitData(telegramUserId) },
  });
  const body = created.json() as { token: string; user: { userId: string } };
  await app.close();
  return { token: body.token, userId: body.user.userId };
}

test("GET /cases/free requires auth and returns display catalog", async () => {
  const app = createApiApp({ db, authPolicy: policy });
  const denied = await app.inject({ method: "GET", url: "/cases/free" });
  assert.equal(denied.statusCode, 401);
  const mini = await miniToken(98001);
  const ok = await app.inject({
    method: "GET",
    url: "/cases/free",
    headers: { authorization: `Bearer ${mini.token}` },
  });
  assert.equal(ok.statusCode, 200);
  const body = ok.json() as {
    available: boolean;
    catalog: Array<{ displayChance: string; itemCode: string }>;
    displayTotals: { legendary: string; epic: string; common: string };
  };
  assert.equal(body.available, true);
  assert.equal(body.catalog.length, 16);
  assert.equal(body.displayTotals.legendary, "6");
  assert.ok(!JSON.stringify(body).includes("realWeight"));
  await app.close();
});

test("POST open is auth+idempotent and rejects injected result", async () => {
  const mini = await miniToken(98002);
  const app = createApiApp({ db, authPolicy: policy });
  const injected = await app.inject({
    method: "POST",
    url: "/cases/free/open",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "inj",
    },
    payload: { itemCode: "azc-100", reward: "hack", rarity: "legendary" },
  });
  assert.equal(injected.statusCode, 400);

  const created = await app.inject({
    method: "POST",
    url: "/cases/free/open",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "open-1",
    },
    payload: {},
  });
  assert.equal(created.statusCode, 200);
  const body = created.json() as {
    openingId: string;
    result: { itemCode: string; displayChance: string; realChance: string };
    replayed: boolean;
  };
  assert.equal(body.replayed, false);
  assert.ok(body.result.itemCode);

  const replay = await app.inject({
    method: "POST",
    url: "/cases/free/open",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "open-1",
    },
    payload: {},
  });
  assert.equal(replay.statusCode, 200);
  assert.equal((replay.json() as { openingId: string }).openingId, body.openingId);
  assert.equal((replay.json() as { replayed: boolean }).replayed, true);

  const blocked = await app.inject({
    method: "POST",
    url: "/cases/free/open",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "open-2",
    },
    payload: {},
  });
  assert.equal(blocked.statusCode, 409);
  assert.equal(
    (blocked.json() as { error: string }).error,
    "FREE_CASE_COOLDOWN_ACTIVE",
  );
  assert.ok((blocked.json() as { nextAvailableAt?: string }).nextAvailableAt);

  const openings = await db
    .select()
    .from(freeCaseOpenings)
    .where(eq(freeCaseOpenings.userId, mini.userId));
  assert.equal(openings.length, 1);
  await app.close();
});

test("history is own-user only and recent wins are readable", async () => {
  const a = await miniToken(98003);
  const b = await miniToken(98004);
  const app = createApiApp({ db, authPolicy: policy });
  await app.inject({
    method: "POST",
    url: "/cases/free/open",
    headers: {
      authorization: `Bearer ${a.token}`,
      "idempotency-key": "hist-a",
    },
    payload: {},
  });
  const own = await app.inject({
    method: "GET",
    url: "/cases/history?caseCode=free",
    headers: { authorization: `Bearer ${a.token}` },
  });
  const other = await app.inject({
    method: "GET",
    url: "/cases/history?caseCode=free",
    headers: { authorization: `Bearer ${b.token}` },
  });
  assert.equal(own.statusCode, 200);
  assert.equal((own.json() as { items: unknown[] }).items.length, 1);
  assert.equal(other.statusCode, 200);
  assert.equal((other.json() as { items: unknown[] }).items.length, 0);

  const recent = await app.inject({
    method: "GET",
    url: "/recent-wins",
    headers: { authorization: `Bearer ${b.token}` },
  });
  assert.equal(recent.statusCode, 200);
  assert.ok((recent.json() as { items: unknown[] }).items.length >= 1);
  await app.close();
});

test("wallet free_case_reward type is accepted by ledger when AZC hits", async () => {
  // Smoke: enum exists via a successful open path (reward may be gram/external/azc).
  const mini = await miniToken(98005);
  const app = createApiApp({ db, authPolicy: policy });
  const opened = await app.inject({
    method: "POST",
    url: "/cases/free/open",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "type-check",
    },
    payload: {},
  });
  assert.equal(opened.statusCode, 200);
  const ledger = await db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, mini.userId));
  assert.ok(
    ledger.every(
      (row) => row.type !== "free_case_reward" || Number(row.amountMinor) > 0,
    ),
  );
  await app.close();
});
