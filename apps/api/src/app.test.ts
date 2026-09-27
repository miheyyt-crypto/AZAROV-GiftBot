import {
  buildSignedInitData,
  countActiveMiniAppSessions,
  createAuthPolicy,
} from "@giftbot/auth";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import { inboundEvents, jobs, sessions, telegramAccounts } from "@giftbot/db/schema";
import { countMiniAppOnline } from "@giftbot/domain";
import { and, eq, isNull } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApiApp } from "./app.js";

const botToken = "123456:TEST-BOT-TOKEN";
const policy = createAuthPolicy(botToken);

let postgres: DevPostgres;
let sqlEnd: () => Promise<void>;
let db: ReturnType<typeof createDb>["db"];

before(async () => {
  postgres = await startDevPostgres({ port: 55435 });
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
    { id: telegramUserId, first_name: "Api" },
    Math.floor(Date.now() / 1000),
  );
}

test("GET /health/live stays read-only", async () => {
  const inboundBefore = (await db.select().from(inboundEvents)).length;
  const jobsBefore = (await db.select().from(jobs)).length;
  const app = createApiApp({ db, authPolicy: policy });
  const live = await app.inject({ method: "GET", url: "/health/live" });
  const scraped = await app.inject({ method: "GET", url: "/metrics" });
  assert.equal(live.statusCode, 200);
  assert.deepEqual(live.json(), { status: "live", process: "api" });
  assert.ok(live.headers["x-request-id"]);
  assert.equal(scraped.statusCode, 200);
  assert.equal((await db.select().from(inboundEvents)).length, inboundBefore);
  assert.equal((await db.select().from(jobs)).length, jobsBefore);
  await app.close();
});

test("GET /auth/telegram does not create a session", async () => {
  const app = createApiApp({ db, authPolicy: policy });
  const response = await app.inject({ method: "GET", url: "/auth/telegram" });
  assert.ok(response.statusCode === 404 || response.statusCode === 405);
  await app.close();
});

test("POST /auth/telegram issues a token and GET does not add another session", async () => {
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: "/auth/telegram",
    payload: { initData: signedInitData(88001) },
  });
  assert.equal(created.statusCode, 200);
  const body = created.json() as {
    token: string;
    expiresAt: string;
    user: { userId: string; publicId: string };
  };
  assert.ok(body.token);
  assert.ok(body.expiresAt);
  assert.equal(await countActiveMiniAppSessions(db, body.user.userId), 1);

  await app.inject({ method: "GET", url: "/health/live" });
  await app.inject({ method: "GET", url: "/auth/telegram" });
  await app.inject({ method: "GET", url: "/bootstrap" });
  assert.equal(await countActiveMiniAppSessions(db, body.user.userId), 1);

  const loggedOut = await app.inject({
    method: "POST",
    url: "/auth/logout",
    headers: { authorization: `Bearer ${body.token}` },
  });
  assert.equal(loggedOut.statusCode, 204);
  assert.equal(await countActiveMiniAppSessions(db, body.user.userId), 0);
  await app.close();
});

test("invalid initData is 401", async () => {
  const app = createApiApp({ db, authPolicy: policy });
  const response = await app.inject({
    method: "POST",
    url: "/auth/telegram",
    payload: { initData: "user=%7B%7D&hash=00" },
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("GET /health/ready is a read-only SELECT 1", async () => {
  const app = createApiApp({ db, authPolicy: policy });
  const ready = await app.inject({ method: "GET", url: "/health/ready" });
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.json().status, "ready");
  await app.close();
});

test("GET /health/ready without a database is 503", async () => {
  const app = createApiApp();
  const ready = await app.inject({ method: "GET", url: "/health/ready" });
  assert.equal(ready.statusCode, 503);
  await app.close();
});

test("GET /bootstrap without a session is 401 and writes nothing", async () => {
  const inboundBefore = (await db.select().from(inboundEvents)).length;
  const app = createApiApp({ db, authPolicy: policy });
  const response = await app.inject({ method: "GET", url: "/bootstrap" });
  assert.equal(response.statusCode, 401);
  assert.equal((await db.select().from(inboundEvents)).length, inboundBefore);
  await app.close();
});

test("GET /bootstrap is small and does not write", async () => {
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: "/auth/telegram",
    payload: { initData: signedInitData(88002) },
  });
  const auth = created.json() as { token: string; user: { userId: string } };
  const beforeAccounts = await db
    .select()
    .from(telegramAccounts)
    .where(eq(telegramAccounts.userId, auth.user.userId));
  const inboundBefore = (await db.select().from(inboundEvents)).length;
  const jobsBefore = (await db.select().from(jobs)).length;

  const bootstrap = await app.inject({
    method: "GET",
    url: "/bootstrap",
    headers: { authorization: `Bearer ${auth.token}` },
  });
  assert.equal(bootstrap.statusCode, 200);
  const body = bootstrap.json() as {
    user: { publicId: string };
    wallet: { balanceMinor: string; currencyCode: string };
    session: { expiresAt: string };
    flags: { kickLinked: boolean };
    counters: { referralsAttributed: number };
    referralCode: string;
    configVersion: string;
  };
  assert.ok(body.user.publicId);
  assert.equal(body.wallet.balanceMinor, "0");
  assert.equal(body.flags.kickLinked, false);
  assert.equal(body.counters.referralsAttributed, 0);
  assert.ok(body.referralCode);
  assert.ok(!("catalogs" in body));
  assert.ok(!("ledger" in body));

  const afterAccounts = await db
    .select()
    .from(telegramAccounts)
    .where(eq(telegramAccounts.userId, auth.user.userId));
  assert.deepEqual(beforeAccounts[0]?.lastSeenAt, afterAccounts[0]?.lastSeenAt);
  assert.equal((await db.select().from(inboundEvents)).length, inboundBefore);
  assert.equal((await db.select().from(jobs)).length, jobsBefore);
  assert.equal(await countActiveMiniAppSessions(db, auth.user.userId), 1);
  await app.close();
});

test("GET /sections is read-only and has no catalogs", async () => {
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: "/auth/telegram",
    payload: { initData: signedInitData(88003) },
  });
  const auth = created.json() as { token: string; user: { userId: string } };
  const inboundBefore = (await db.select().from(inboundEvents)).length;
  const beforeAccounts = await db
    .select()
    .from(telegramAccounts)
    .where(eq(telegramAccounts.userId, auth.user.userId));

  const home = await app.inject({
    method: "GET",
    url: "/sections/home",
    headers: { authorization: `Bearer ${auth.token}` },
  });
  const referrals = await app.inject({
    method: "GET",
    url: "/sections/referrals",
    headers: { authorization: `Bearer ${auth.token}` },
  });
  const games = await app.inject({
    method: "GET",
    url: "/sections/games",
    headers: { authorization: `Bearer ${auth.token}` },
  });
  const missing = await app.inject({
    method: "GET",
    url: "/sections/admin",
    headers: { authorization: `Bearer ${auth.token}` },
  });
  assert.equal(home.statusCode, 200);
  assert.deepEqual(home.json(), { section: "home", available: true });
  assert.equal(referrals.statusCode, 200);
  assert.equal(referrals.json().section, "referrals");
  assert.ok(!("items" in home.json()));
  assert.ok(!("catalog" in referrals.json()));
  assert.equal(games.statusCode, 200);
  assert.deepEqual(games.json(), { section: "games", available: true, games: [] });
  assert.equal(missing.statusCode, 404);

  const afterAccounts = await db
    .select()
    .from(telegramAccounts)
    .where(eq(telegramAccounts.userId, auth.user.userId));
  assert.deepEqual(beforeAccounts[0]?.lastSeenAt, afterAccounts[0]?.lastSeenAt);
  assert.equal((await db.select().from(inboundEvents)).length, inboundBefore);
  await app.close();
});

test("GET /auth/presence does not write; POST stamps Mini App lastUsedAt", async () => {
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: "/auth/telegram",
    payload: { initData: signedInitData(88099) },
  });
  const auth = created.json() as { token: string; user: { userId: string } };
  const getPresence = await app.inject({ method: "GET", url: "/auth/presence" });
  assert.ok(getPresence.statusCode === 404 || getPresence.statusCode === 405);

  const bootstrap = await app.inject({
    method: "GET",
    url: "/bootstrap",
    headers: { authorization: `Bearer ${auth.token}` },
  });
  assert.equal(bootstrap.statusCode, 200);
  const before = (
    await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, auth.user.userId), isNull(sessions.revokedAt)))
  )[0];
  assert.equal(before?.lastUsedAt, null);
  assert.equal(await countMiniAppOnline(db), 0);

  const presence = await app.inject({
    method: "POST",
    url: "/auth/presence",
    headers: { authorization: `Bearer ${auth.token}` },
  });
  assert.equal(presence.statusCode, 204);
  const after = (
    await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, auth.user.userId), isNull(sessions.revokedAt)))
  )[0];
  assert.ok(after?.lastUsedAt);
  assert.equal(await countMiniAppOnline(db), 1);

  const unauth = await app.inject({ method: "POST", url: "/auth/presence" });
  assert.equal(unauth.statusCode, 401);
  await app.close();
});
