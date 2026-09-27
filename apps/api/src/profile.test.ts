import {
  buildSignedInitData,
  createAuthPolicy,
} from "@giftbot/auth";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import {
  inboundEvents,
  jobs,
  notifications,
  telegramAccounts,
  walletTransactions,
} from "@giftbot/db/schema";
import { apply } from "@giftbot/domain";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApiApp } from "./app.js";

const botToken = "123456:TEST-BOT-TOKEN";
const policy = createAuthPolicy(botToken);

let postgres: DevPostgres;
let sqlEnd: () => Promise<void>;
let db: ReturnType<typeof createDb>["db"];

before(async () => {
  postgres = await startDevPostgres({ port: 55448 });
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

function signedInitData(
  telegramUserId: number,
  extra: Record<string, unknown> = {},
): string {
  return buildSignedInitData(
    botToken,
    {
      id: telegramUserId,
      first_name: "Api",
      ...extra,
    },
    Math.floor(Date.now() / 1000),
  );
}

async function authAs(telegramUserId: number, extra: Record<string, unknown> = {}) {
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: "/auth/telegram",
    payload: { initData: signedInitData(telegramUserId, extra) },
  });
  const body = created.json() as { token: string; user: { userId: string } };
  await app.close();
  return body;
}

test("GET /profile is authenticated and ignores another userId", async () => {
  const first = await authAs(93001, { username: "one" });
  const second = await authAs(93002, { username: "two" });
  const inboundBefore = (await db.select().from(inboundEvents)).length;
  const app = createApiApp({ db, authPolicy: policy });
  const mine = await app.inject({
    method: "GET",
    url: `/profile?userId=${second.user.userId}`,
    headers: { authorization: `Bearer ${first.token}` },
  });
  assert.equal(mine.statusCode, 200);
  const body = mine.json() as {
    user: { telegramUsername: string | null };
    balances: { azc: string; gram: string };
    level: { current: number; nextRewardAzc: string | null };
  };
  assert.equal(body.user.telegramUsername, "one");
  assert.equal(body.balances.azc, "0");
  assert.equal(body.balances.gram, "0");
  assert.equal(body.level.current, 1);
  assert.equal(body.level.nextRewardAzc, "100");
  assert.equal((await db.select().from(inboundEvents)).length, inboundBefore);
  await app.close();
});

test("GET /profile/notifications is empty and read-only", async () => {
  const auth = await authAs(93003);
  const inboundBefore = (await db.select().from(inboundEvents)).length;
  const jobsBefore = (await db.select().from(jobs)).length;
  const app = createApiApp({ db, authPolicy: policy });
  const listed = await app.inject({
    method: "GET",
    url: "/profile/notifications",
    headers: { authorization: `Bearer ${auth.token}` },
  });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json(), { items: [], nextCursor: null });
  assert.equal((await db.select().from(inboundEvents)).length, inboundBefore);
  assert.equal((await db.select().from(jobs)).length, jobsBefore);
  await app.close();
});

test("GET /profile/ledger returns the caller ledger only", async () => {
  const first = await authAs(93004);
  const second = await authAs(93005);
  await apply(db, {
    userId: first.user.userId,
    type: "referral_reward",
    amountMinor: 1000n,
    idempotencyKey: `api-ref:${first.user.userId}`,
    actorType: "system",
  });
  await apply(db, {
    userId: second.user.userId,
    type: "reward",
    amountMinor: 50n,
    idempotencyKey: `api-reward:${second.user.userId}`,
    actorType: "system",
  });
  const app = createApiApp({ db, authPolicy: policy });
  const listed = await app.inject({
    method: "GET",
    url: "/profile/ledger?limit=1",
    headers: { authorization: `Bearer ${first.token}` },
  });
  assert.equal(listed.statusCode, 200);
  const body = listed.json() as {
    items: Array<{ label: string; delta: string }>;
    nextCursor: string | null;
  };
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0]?.label, "Реферальная награда");
  assert.equal(body.items[0]?.delta, "1000");
  const otherTx = await db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, second.user.userId));
  assert.equal(otherTx.length, 1);
  await app.close();
});

test("GET /profile/inventory and orders start empty", async () => {
  const auth = await authAs(93006);
  const app = createApiApp({ db, authPolicy: policy });
  const inventory = await app.inject({
    method: "GET",
    url: "/profile/inventory",
    headers: { authorization: `Bearer ${auth.token}` },
  });
  const orders = await app.inject({
    method: "GET",
    url: "/profile/orders",
    headers: { authorization: `Bearer ${auth.token}` },
  });
  assert.equal(inventory.statusCode, 200);
  assert.deepEqual(inventory.json(), { items: [], nextCursor: null });
  assert.equal(orders.statusCode, 200);
  assert.deepEqual(orders.json(), { items: [], nextCursor: null });
  await app.close();
});

test("GET /profile list query rejects a bad cursor without writing", async () => {
  const auth = await authAs(93008);
  const notesBefore = (await db.select().from(notifications)).length;
  const app = createApiApp({ db, authPolicy: policy });
  const response = await app.inject({
    method: "GET",
    url: "/profile/notifications?cursor=not-a-cursor",
    headers: { authorization: `Bearer ${auth.token}` },
  });
  assert.equal(response.statusCode, 400);
  assert.equal((await db.select().from(notifications)).length, notesBefore);
  await app.close();
});

test("GET /profile without a session is 401 and writes nothing", async () => {
  const notesBefore = (await db.select().from(notifications)).length;
  const app = createApiApp({ db, authPolicy: policy });
  const response = await app.inject({ method: "GET", url: "/profile" });
  assert.equal(response.statusCode, 401);
  assert.equal((await db.select().from(notifications)).length, notesBefore);
  await app.close();
});

test("GET /profile does not update telegram lastSeenAt", async () => {
  const auth = await authAs(93007);
  const before = await db
    .select()
    .from(telegramAccounts)
    .where(eq(telegramAccounts.userId, auth.user.userId));
  const app = createApiApp({ db, authPolicy: policy });
  await app.inject({
    method: "GET",
    url: "/profile",
    headers: { authorization: `Bearer ${auth.token}` },
  });
  const afterRows = await db
    .select()
    .from(telegramAccounts)
    .where(eq(telegramAccounts.userId, auth.user.userId));
  assert.deepEqual(before[0]?.lastSeenAt, afterRows[0]?.lastSeenAt);
  await app.close();
});

test("GET /profile and /bootstrap return avatarUrl from Telegram photo_url", async () => {
  const photo = "https://t.me/i/userpic/320/profile.jpg";
  const auth = await authAs(93009, { photo_url: photo });
  const app = createApiApp({ db, authPolicy: policy });
  const profile = await app.inject({
    method: "GET",
    url: "/profile",
    headers: { authorization: `Bearer ${auth.token}` },
  });
  assert.equal(profile.statusCode, 200);
  const profileBody = profile.json() as { user: { avatarUrl: string | null } };
  assert.equal(profileBody.user.avatarUrl, photo);

  const bootstrap = await app.inject({
    method: "GET",
    url: "/bootstrap",
    headers: { authorization: `Bearer ${auth.token}` },
  });
  assert.equal(bootstrap.statusCode, 200);
  const bootstrapBody = bootstrap.json() as { user: { avatarUrl: string | null } };
  assert.equal(bootstrapBody.user.avatarUrl, photo);
  await app.close();
});

