import {
  buildSignedInitData,
  createAuthPolicy,
} from "@giftbot/auth";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApiApp } from "./app.js";

const botToken = "123456:TEST-BOT-TOKEN-REFERRAL";
const policy = createAuthPolicy(botToken);

let postgres: DevPostgres;
let sqlEnd: () => Promise<void>;
let db: ReturnType<typeof createDb>["db"];

before(async () => {
  postgres = await startDevPostgres({ port: 55472 });
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

function signedInitData(telegramUserId: number, username?: string): string {
  return buildSignedInitData(
    botToken,
    {
      id: telegramUserId,
      first_name: "Ref",
      ...(username ? { username } : {}),
    },
    Math.floor(Date.now() / 1000),
  );
}

async function miniToken(
  telegramUserId: number,
  username?: string,
): Promise<{ token: string; userId: string }> {
  const app = createApiApp({
    db,
    authPolicy: policy,
    allowDevAuth: true,
    telegramBotUsername: "giftbot_test",
  });
  const created = await app.inject({
    method: "POST",
    url: "/auth/telegram",
    payload: { initData: signedInitData(telegramUserId, username) },
  });
  const body = created.json() as { token: string; user: { userId: string } };
  await app.close();
  return { token: body.token, userId: body.user.userId };
}

function authApp() {
  return createApiApp({
    db,
    authPolicy: policy,
    allowDevAuth: true,
    telegramBotUsername: "giftbot_test",
  });
}

test("GET /referrals/me requires auth and returns opaque referral URL", async () => {
  const app = authApp();
  const denied = await app.inject({ method: "GET", url: "/referrals/me" });
  assert.equal(denied.statusCode, 401);

  const mini = await miniToken(98001, "inviter");
  const ok = await app.inject({
    method: "GET",
    url: "/referrals/me",
    headers: { authorization: `Bearer ${mini.token}` },
  });
  assert.equal(ok.statusCode, 200);
  const body = ok.json() as {
    referralUrl: string;
    token: string;
    stats: { invited: number; active: number; earnedAzc: string };
    caseProgress: {
      current: number;
      target: number;
      availableCases: number;
      totalCasesEarned: number;
    };
  };
  assert.match(body.referralUrl, /^https:\/\/t\.me\/giftbot_test\?start=/);
  assert.ok(!body.referralUrl.includes(mini.userId));
  assert.equal(body.token.length > 0, true);
  assert.equal(body.stats.invited, 0);
  assert.equal(body.caseProgress.target, 5);
  await app.close();
});

test("GET /referrals lists own referrals", async () => {
  const inviter = await miniToken(98002, "list_inv");
  const referee = await miniToken(98003, "list_ref");
  const app = authApp();

  const me = await app.inject({
    method: "GET",
    url: "/referrals/me",
    headers: { authorization: `Bearer ${inviter.token}` },
  });
  const code = (me.json() as { token: string }).token;

  const attributed = await app.inject({
    method: "POST",
    url: "/dev/referrals/attribute",
    headers: { authorization: `Bearer ${referee.token}` },
    payload: { code },
  });
  assert.equal(attributed.statusCode, 200);

  const listed = await app.inject({
    method: "GET",
    url: "/referrals",
    headers: { authorization: `Bearer ${inviter.token}` },
  });
  assert.equal(listed.statusCode, 200);
  const body = listed.json() as {
    items: Array<{ id: string; status: string; username: string | null }>;
    nextCursor: string | null;
  };
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0]?.status, "attributed");
  assert.equal(body.items[0]?.username, "list_ref");
  await app.close();
});

test("POST open referral case with entitlement and not available", async () => {
  const inviter = await miniToken(98010, "case_inv");
  const app = authApp();

  const noEntitlement = await app.inject({
    method: "POST",
    url: "/cases/referral/open",
    headers: {
      authorization: `Bearer ${inviter.token}`,
      "idempotency-key": "no-ent",
    },
    payload: {},
  });
  assert.equal(noEntitlement.statusCode, 409);
  assert.equal(
    (noEntitlement.json() as { error: string }).error,
    "REFERRAL_CASE_NOT_AVAILABLE",
  );

  const seeded = await app.inject({
    method: "POST",
    url: "/dev/referrals/qa-seed",
    headers: { authorization: `Bearer ${inviter.token}` },
    payload: { count: 5 },
  });
  assert.equal(seeded.statusCode, 200, seeded.body);
  const seedBody = seeded.json() as {
    caseProgress: { availableCases: number };
  };
  assert.equal(seedBody.caseProgress.availableCases, 1);

  const catalog = await app.inject({
    method: "GET",
    url: "/cases/referral",
    headers: { authorization: `Bearer ${inviter.token}` },
  });
  assert.equal(catalog.statusCode, 200);
  const catalogBody = catalog.json() as {
    code: string;
    availableCases: number;
    items: Array<{ displayChance: string | null }>;
  };
  assert.equal(catalogBody.code, "referral");
  assert.equal(catalogBody.availableCases, 1);
  for (const item of catalogBody.items) {
    assert.equal(item.displayChance, null);
  }

  for (const payload of [
    { result: "win" },
    { itemCode: "x" },
    { rewardAmount: "1" },
    { userId: inviter.userId },
  ]) {
    const injected = await app.inject({
      method: "POST",
      url: "/cases/referral/open",
      headers: {
        authorization: `Bearer ${inviter.token}`,
        "idempotency-key": `inj-${Object.keys(payload)[0]}`,
      },
      payload,
    });
    assert.equal(injected.statusCode, 400, JSON.stringify(payload));
  }

  const opened = await app.inject({
    method: "POST",
    url: "/cases/referral/open",
    headers: {
      authorization: `Bearer ${inviter.token}`,
      "idempotency-key": "open-ref-1",
    },
    payload: {},
  });
  assert.equal(opened.statusCode, 200, opened.body);
  const openBody = opened.json() as {
    openingId: string;
    caseCode: string;
    result: { displayChance: string | null; itemCode: string };
    availableCases: number;
    replayed: boolean;
  };
  assert.equal(openBody.caseCode, "referral");
  assert.equal(openBody.replayed, false);
  assert.equal(openBody.result.displayChance, null);
  assert.equal(openBody.availableCases, 0);
  assert.ok(openBody.openingId);

  const replay = await app.inject({
    method: "POST",
    url: "/cases/referral/open",
    headers: {
      authorization: `Bearer ${inviter.token}`,
      "idempotency-key": "open-ref-1",
    },
    payload: {},
  });
  assert.equal(replay.statusCode, 200);
  assert.equal((replay.json() as { replayed: boolean }).replayed, true);

  const history = await app.inject({
    method: "GET",
    url: "/cases/history?caseCode=referral",
    headers: { authorization: `Bearer ${inviter.token}` },
  });
  assert.equal(history.statusCode, 200);
  const historyBody = history.json() as {
    items: Array<{ caseCode: string; openingId: string }>;
  };
  assert.equal(historyBody.items.length, 1);
  assert.equal(historyBody.items[0]?.caseCode, "referral");
  assert.equal(historyBody.items[0]?.openingId, openBody.openingId);
  await app.close();
});

test("GET /leaderboard/referrals returns ranks for session user", async () => {
  const top = await miniToken(98020, "lb_top");
  const low = await miniToken(98021, "lb_low");
  const app = authApp();

  const seedTop = await app.inject({
    method: "POST",
    url: "/dev/referrals/qa-seed",
    headers: { authorization: `Bearer ${top.token}` },
    payload: { count: 3 },
  });
  assert.equal(seedTop.statusCode, 200);

  const seedLow = await app.inject({
    method: "POST",
    url: "/dev/referrals/qa-seed",
    headers: { authorization: `Bearer ${low.token}` },
    payload: { count: 1 },
  });
  assert.equal(seedLow.statusCode, 200);

  const board = await app.inject({
    method: "GET",
    url: "/leaderboard/referrals",
    headers: { authorization: `Bearer ${top.token}` },
  });
  assert.equal(board.statusCode, 200);
  const body = board.json() as {
    items: Array<{
      rank: number;
      publicId: string | null;
      activeReferrals: number;
      isYou: boolean;
      userId?: string;
    }>;
    self: { rank: number; isYou: boolean; activeReferrals: number } | null;
  };
  assert.ok(body.items.length >= 2);
  const topRow = body.items.find((row) => row.isYou);
  assert.ok(topRow);
  assert.ok((topRow?.activeReferrals ?? 0) >= 3);
  const lowRow = body.items.find(
    (row) => !row.isYou && (row.activeReferrals ?? 0) === 1,
  );
  assert.ok(lowRow);
  assert.ok((topRow?.activeReferrals ?? 0) > (lowRow?.activeReferrals ?? 0));
  assert.ok(body.self);
  assert.equal(body.self?.isYou, true);
  for (const row of body.items) {
    assert.equal(row.userId, undefined);
  }
  await app.close();
});

test("dev referral helpers are 404 when allowDevAuth is false", async () => {
  const app = createApiApp({ db, authPolicy: policy, allowDevAuth: false });
  for (const url of [
    "/dev/referrals/attribute",
    "/dev/referrals/qa-seed",
    "/dev/referrals/00000000-0000-0000-0000-000000000001/activate-kick",
  ]) {
    const denied = await app.inject({
      method: "POST",
      url,
      payload: {},
    });
    assert.equal(denied.statusCode, 404, url);
  }
  await app.close();
});
