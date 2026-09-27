import {
  buildSignedInitData,
  createAuthPolicy,
} from "@giftbot/auth";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import { adminRoleAssignments, adminRoles } from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApiApp } from "./app.js";
import { REFERRAL_CONTEST_DEFAULT_PRIZES } from "@giftbot/domain";

const botToken = "123456:TEST-BOT-TOKEN-CONTEST";
const policy = createAuthPolicy(botToken);

const PRIZES = [...REFERRAL_CONTEST_DEFAULT_PRIZES];

let postgres: DevPostgres;
let sqlEnd: () => Promise<void>;
let db: ReturnType<typeof createDb>["db"];

before(async () => {
  postgres = await startDevPostgres({ port: 55521 });
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
    { id: telegramUserId, first_name: "User" },
    Math.floor(Date.now() / 1000),
  );
}

async function assignSuperAdmin(userId: string): Promise<void> {
  const roles = await db
    .select()
    .from(adminRoles)
    .where(eq(adminRoles.name, "super_admin"))
    .limit(1);
  const role = roles[0];
  assert.ok(role);
  await db.insert(adminRoleAssignments).values({
    userId,
    roleId: role.id,
  });
}

async function miniToken(telegramUserId: number) {
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

async function adminToken(telegramUserId: number) {
  const mini = await miniToken(telegramUserId);
  await assignSuperAdmin(mini.userId);
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: "/admin/auth",
    payload: { initData: signedInitData(telegramUserId) },
  });
  assert.equal(created.statusCode, 200);
  const body = created.json() as { token: string };
  await app.close();
  return { token: body.token, userId: mini.userId };
}

test("GET contest summary and page require Mini App auth", async () => {
  const app = createApiApp({ db, authPolicy: policy });
  const summary = await app.inject({ method: "GET", url: "/contest/referral/summary" });
  const page = await app.inject({ method: "GET", url: "/contest/referral" });
  assert.equal(summary.statusCode, 401);
  assert.equal(page.statusCode, 401);
  await app.close();
});

test("admin contest create requires super_admin and GET is read-only", async () => {
  const mini = await miniToken(93101);
  const admin = await adminToken(93102);
  const app = createApiApp({
    db,
    authPolicy: policy,
    telegramBotUsername: "AZAROV_GiftBot",
  });
  const forbidden = await app.inject({
    method: "POST",
    url: "/admin/contest/referral",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "contest-mini",
    },
    payload: { startNow: true, prizes: PRIZES },
  });
  assert.equal(forbidden.statusCode, 401);

  const created = await app.inject({
    method: "POST",
    url: "/admin/contest/referral",
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "contest-create-1",
    },
    payload: { startNow: true, prizes: PRIZES },
  });
  assert.equal(created.statusCode, 200);
  const body = created.json() as { id: string };

  const userPage = await app.inject({
    method: "GET",
    url: "/contest/referral",
    headers: { authorization: `Bearer ${mini.token}` },
  });
  assert.equal(userPage.statusCode, 200);
  const page = userPage.json() as {
    contest: { id: string; prizePoolAzc: string } | null;
    leaderboard: unknown[];
    me: { rank: number; referralUrl: string | null };
  };
  assert.equal(page.contest?.id, body.id);
  assert.equal(page.contest?.prizePoolAzc, "100000");
  assert.equal(
    (userPage.json() as { contest: { prizePlaces: number; prizes: unknown[] } }).contest
      .prizePlaces,
    10,
  );
  assert.equal(
    (userPage.json() as { contest: { prizes: unknown[] } }).contest.prizes.length,
    10,
  );
  assert.ok(Array.isArray(page.leaderboard));
  assert.match(String(page.me.referralUrl), /t\.me\/AZAROV_GiftBot\?start=/);

  const summary = await app.inject({
    method: "GET",
    url: "/contest/referral/summary",
    headers: { authorization: `Bearer ${mini.token}` },
  });
  assert.equal(summary.statusCode, 200);
  assert.equal(summary.json().contest.id, body.id);
  assert.equal("leaderboard" in summary.json().contest, false);

  const adminGet = await app.inject({
    method: "GET",
    url: "/admin/contest/referral",
    headers: { authorization: `Bearer ${admin.token}` },
  });
  assert.equal(adminGet.statusCode, 200);

  const dup = await app.inject({
    method: "POST",
    url: "/admin/contest/referral",
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "contest-create-2",
    },
    payload: { startNow: true, prizes: PRIZES },
  });
  assert.equal(dup.statusCode, 409);
  await app.close();
});
