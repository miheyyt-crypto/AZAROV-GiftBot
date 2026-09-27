import {
  buildSignedInitData,
  createAuthPolicy,
} from "@giftbot/auth";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import { paidCaseOpenings } from "@giftbot/db/schema";
import { apply, openPaidCase } from "@giftbot/domain";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApiApp } from "./app.js";

const botToken = "123456:TEST-BOT-TOKEN-PAID-CASE";
const policy = createAuthPolicy(botToken);

let postgres: DevPostgres;
let sqlEnd: () => Promise<void>;
let db: ReturnType<typeof createDb>["db"];

before(async () => {
  postgres = await startDevPostgres({ port: 55471 });
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
    { id: telegramUserId, first_name: "Paid", username: `p${telegramUserId}` },
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

async function credit(userId: string, amount: bigint, key: string): Promise<void> {
  await apply(db, {
    userId,
    type: "deposit",
    amountMinor: amount,
    idempotencyKey: key,
    actorType: "system",
  });
}

test("GET /cases/paid requires auth and returns exact catalog prices", async () => {
  const app = createApiApp({ db, authPolicy: policy });
  const denied = await app.inject({ method: "GET", url: "/cases/paid" });
  assert.equal(denied.statusCode, 401);

  const mini = await miniToken(97001);
  const ok = await app.inject({
    method: "GET",
    url: "/cases/paid",
    headers: { authorization: `Bearer ${mini.token}` },
  });
  assert.equal(ok.statusCode, 200);
  const body = ok.json() as {
    items: Array<{
      code: string;
      priceAzc: string;
      items: Array<{ displayChance: string | null }>;
    }>;
  };
  const byCode = Object.fromEntries(body.items.map((row) => [row.code, row]));
  assert.equal(byCode.poor?.priceAzc, "8999");
  assert.equal(byCode.medium?.priceAzc, "22222");
  assert.equal(byCode.blatnoy?.priceAzc, "64999");
  for (const paid of body.items) {
    for (const item of paid.items) {
      assert.equal(item.displayChance, null);
    }
  }
  assert.ok(!JSON.stringify(body).includes("realWeight"));
  assert.ok(!JSON.stringify(body).includes('"weight"'));
  await app.close();
});

test("POST open requires auth and rejects injected price/result", async () => {
  const mini = await miniToken(97002);
  await credit(mini.userId, 1_000_000n, "fund-inj");
  const app = createApiApp({ db, authPolicy: policy });

  const denied = await app.inject({
    method: "POST",
    url: "/cases/poor/open",
    headers: { "idempotency-key": "no-auth" },
    payload: {},
  });
  assert.equal(denied.statusCode, 401);

  for (const payload of [
    { price: "1" },
    { priceAzc: "1" },
    { result: "win" },
    { reward: "hack" },
    { chance: "100" },
    { itemCode: "poor-azc-3333" },
    { userId: mini.userId },
  ]) {
    const injected = await app.inject({
      method: "POST",
      url: "/cases/poor/open",
      headers: {
        authorization: `Bearer ${mini.token}`,
        "idempotency-key": `inj-${Object.keys(payload)[0]}`,
      },
      payload,
    });
    assert.equal(injected.statusCode, 400, JSON.stringify(payload));
  }
  await app.close();
});

test("POST open poor/medium/blatnoy is idempotent and returns response shape", async () => {
  const mini = await miniToken(97003);
  await credit(mini.userId, 500_000n, "fund-open-all");
  const app = createApiApp({ db, authPolicy: policy });

  for (const caseCode of ["poor", "medium", "blatnoy"] as const) {
    const created = await app.inject({
      method: "POST",
      url: `/cases/${caseCode}/open`,
      headers: {
        authorization: `Bearer ${mini.token}`,
        "idempotency-key": `open-${caseCode}`,
      },
      payload: {},
    });
    assert.equal(created.statusCode, 200, caseCode);
    const body = created.json() as {
      openingId: string;
      caseCode: string;
      priceAzc: string;
      result: {
        itemCode: string;
        title: string;
        rewardType: string;
        displayChance: string | null;
        realChance: string;
        imageKey: string;
      };
      balances: { azc: string };
      replayed: boolean;
    };
    assert.equal(body.caseCode, caseCode);
    assert.equal(body.replayed, false);
    assert.ok(body.openingId);
    assert.ok(body.result.itemCode);
    assert.equal(body.result.displayChance, null);
    assert.ok(body.balances.azc);

    const replay = await app.inject({
      method: "POST",
      url: `/cases/${caseCode}/open`,
      headers: {
        authorization: `Bearer ${mini.token}`,
        "idempotency-key": `open-${caseCode}`,
      },
      payload: {},
    });
    assert.equal(replay.statusCode, 200);
    assert.equal(
      (replay.json() as { openingId: string }).openingId,
      body.openingId,
    );
    assert.equal((replay.json() as { replayed: boolean }).replayed, true);
  }
  await app.close();
});

test("insufficient balance returns CASE_INSUFFICIENT_BALANCE", async () => {
  const mini = await miniToken(97004);
  const app = createApiApp({ db, authPolicy: policy });
  const response = await app.inject({
    method: "POST",
    url: "/cases/poor/open",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "broke",
    },
    payload: {},
  });
  assert.equal(response.statusCode, 409);
  assert.equal(
    (response.json() as { error: string }).error,
    "CASE_INSUFFICIENT_BALANCE",
  );
  await app.close();
});

test("invalid paid case codes return 404; referral open is a separate route", async () => {
  const mini = await miniToken(97005);
  await credit(mini.userId, 100_000n, "fund-404");
  const app = createApiApp({ db, authPolicy: policy });
  for (const caseCode of ["ref", "unknown"]) {
    const response = await app.inject({
      method: "POST",
      url: `/cases/${caseCode}/open`,
      headers: {
        authorization: `Bearer ${mini.token}`,
        "idempotency-key": `404-${caseCode}`,
      },
      payload: {},
    });
    assert.equal(response.statusCode, 404, caseCode);
    assert.equal((response.json() as { error: string }).error, "CASE_NOT_FOUND");
  }
  const referral = await app.inject({
    method: "POST",
    url: "/cases/referral/open",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "referral-no-entitlement",
    },
    payload: {},
  });
  assert.equal(referral.statusCode, 409);
  assert.equal(
    (referral.json() as { error: string }).error,
    "REFERRAL_CASE_NOT_AVAILABLE",
  );
  await app.close();
});

test("history is own-user only for paid cases; recent wins include forced reward", async () => {
  const a = await miniToken(97006);
  const b = await miniToken(97007);
  await credit(a.userId, 100_000n, "fund-hist-a");
  await openPaidCase(db, {
    userId: a.userId,
    caseCode: "poor",
    idempotencyKey: "domain-force-azc",
    forceItemCodeForTests: "poor-azc-3333",
  });
  await openPaidCase(db, {
    userId: a.userId,
    caseCode: "poor",
    idempotencyKey: "domain-force-cash",
    forceItemCodeForTests: "poor-cash-1000",
  });

  const app = createApiApp({ db, authPolicy: policy });
  const own = await app.inject({
    method: "GET",
    url: "/cases/history?caseCode=poor",
    headers: { authorization: `Bearer ${a.token}` },
  });
  const other = await app.inject({
    method: "GET",
    url: "/cases/history?caseCode=poor",
    headers: { authorization: `Bearer ${b.token}` },
  });
  assert.equal(own.statusCode, 200);
  assert.equal((own.json() as { items: unknown[] }).items.length, 2);
  assert.equal(other.statusCode, 200);
  assert.equal((other.json() as { items: unknown[] }).items.length, 0);

  const defaultHistory = await app.inject({
    method: "GET",
    url: "/cases/history",
    headers: { authorization: `Bearer ${a.token}` },
  });
  assert.equal(defaultHistory.statusCode, 200);
  // Missing caseCode defaults to free history (backward compatible).
  assert.equal((defaultHistory.json() as { items: unknown[] }).items.length, 0);

  const recent = await app.inject({
    method: "GET",
    url: "/recent-wins",
    headers: { authorization: `Bearer ${b.token}` },
  });
  assert.equal(recent.statusCode, 200);
  const recentItems = (
    recent.json() as {
      items: Array<{ source: string; rarity: string | null; title: string }>;
    }
  ).items;
  assert.ok(recentItems.some((row) => row.source === "poor_case"));
  assert.ok(recentItems.some((row) => row.rarity === null));
  assert.ok(recentItems.some((row) => row.title.includes("AZC") || row.title.includes("₽")));

  const openings = await db
    .select()
    .from(paidCaseOpenings)
    .where(eq(paidCaseOpenings.userId, a.userId));
  assert.equal(openings.length, 2);
  await app.close();
});
