import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createAuthPolicy } from "@giftbot/auth";
import { isDevAuthEnabled } from "@giftbot/config";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import {
  inventoryItems,
  purchases,
  walletTransactions,
} from "@giftbot/db/schema";
import { ensureDevLocalIdentity } from "@giftbot/domain";
import { eq } from "drizzle-orm";
import { createApiApp } from "./app.js";

const policy = createAuthPolicy("dev-auth-test-bot-token");

let postgres: DevPostgres;
let sqlEnd: () => Promise<void>;
let db: ReturnType<typeof createDb>["db"];

before(async () => {
  postgres = await startDevPostgres({ port: 55481, forceEmbedded: true });
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

test("isDevAuthEnabled requires non-production and ALLOW_DEV_AUTH=true", () => {
  assert.equal(
    isDevAuthEnabled({ NODE_ENV: "production", ALLOW_DEV_AUTH: "true" }),
    false,
  );
  assert.equal(
    isDevAuthEnabled({ NODE_ENV: "development", ALLOW_DEV_AUTH: "false" }),
    false,
  );
  assert.equal(
    isDevAuthEnabled({ NODE_ENV: "development", ALLOW_DEV_AUTH: undefined }),
    false,
  );
  assert.equal(
    isDevAuthEnabled({ NODE_ENV: "development", ALLOW_DEV_AUTH: "true" }),
    true,
  );
  assert.equal(
    isDevAuthEnabled({ NODE_ENV: "test", ALLOW_DEV_AUTH: "true" }),
    true,
  );
});

test("POST /dev/auth is disabled without allowDevAuth", async () => {
  const app = createApiApp({ db, authPolicy: policy, allowDevAuth: false });
  const denied = await app.inject({
    method: "POST",
    url: "/dev/auth",
    payload: { role: "admin" },
  });
  assert.equal(denied.statusCode, 404);
  assert.equal((denied.json() as { error: string }).error, "NOT_FOUND");
  await app.close();
});

test("POST /dev/auth user session can bootstrap and cannot use admin API", async () => {
  const app = createApiApp({ db, authPolicy: policy, allowDevAuth: true });
  const auth = await app.inject({
    method: "POST",
    url: "/dev/auth",
    payload: { role: "user" },
  });
  assert.equal(auth.statusCode, 200);
  const body = auth.json() as {
    token: string;
    role: string;
    adminToken?: string;
  };
  assert.equal(body.role, "user");
  assert.equal(body.adminToken, undefined);

  const boot = await app.inject({
    method: "GET",
    url: "/bootstrap",
    headers: { authorization: `Bearer ${body.token}` },
  });
  assert.equal(boot.statusCode, 200);
  const bootstrap = boot.json() as {
    flags: { isSuperAdmin: boolean };
    wallet: { balanceMinor: string };
  };
  assert.equal(bootstrap.flags.isSuperAdmin, false);
  assert.ok(Number(bootstrap.wallet.balanceMinor) >= 400_000);

  const adminDenied = await app.inject({
    method: "GET",
    url: "/admin/promo-codes",
    headers: { authorization: `Bearer ${body.token}` },
  });
  assert.ok(adminDenied.statusCode === 401 || adminDenied.statusCode === 403);
  await app.close();
});

test("POST /dev/auth admin gets admin token and admin API access", async () => {
  const app = createApiApp({ db, authPolicy: policy, allowDevAuth: true });
  const auth = await app.inject({
    method: "POST",
    url: "/dev/auth",
    payload: { role: "admin" },
  });
  assert.equal(auth.statusCode, 200);
  const body = auth.json() as {
    token: string;
    adminToken: string;
    role: string;
  };
  assert.equal(body.role, "admin");
  assert.ok(body.adminToken);

  const boot = await app.inject({
    method: "GET",
    url: "/bootstrap",
    headers: { authorization: `Bearer ${body.token}` },
  });
  assert.equal(boot.statusCode, 200);
  assert.equal(
    (boot.json() as { flags: { isSuperAdmin: boolean } }).flags.isSuperAdmin,
    true,
  );

  const listed = await app.inject({
    method: "GET",
    url: "/admin/promo-codes",
    headers: { authorization: `Bearer ${body.adminToken}` },
  });
  assert.equal(listed.statusCode, 200);
  await app.close();
});

test("repeated /dev/auth seed does not duplicate balances or inventory", async () => {
  const app = createApiApp({ db, authPolicy: policy, allowDevAuth: true });
  const first = await app.inject({
    method: "POST",
    url: "/dev/auth",
    payload: { role: "user" },
  });
  const token = (first.json() as { token: string }).token;
  const boot1 = await app.inject({
    method: "GET",
    url: "/bootstrap",
    headers: { authorization: `Bearer ${token}` },
  });
  const balance1 = (boot1.json() as { wallet: { balanceMinor: string } }).wallet
    .balanceMinor;

  const second = await app.inject({
    method: "POST",
    url: "/dev/auth",
    payload: { role: "user" },
  });
  assert.equal(second.statusCode, 200);
  const token2 = (second.json() as { token: string }).token;
  const boot2 = await app.inject({
    method: "GET",
    url: "/bootstrap",
    headers: { authorization: `Bearer ${token2}` },
  });
  assert.equal(
    (boot2.json() as { wallet: { balanceMinor: string } }).wallet.balanceMinor,
    balance1,
  );

  const identity = await ensureDevLocalIdentity(db, "user");
  const ledger = await db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, identity.userId));
  const azcCredits = ledger.filter(
    (row) =>
      row.idempotencyKey === "dev-local:user:azc" ||
      row.idempotencyKey === "dev-local:user:ledger:reward",
  );
  assert.equal(azcCredits.length, 2);

  const inventory = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.userId, identity.userId));
  const seeded = inventory.filter((row) => row.source === "dev_local_seed");
  assert.equal(seeded.length, 2);

  const orders = await db
    .select()
    .from(purchases)
    .where(eq(purchases.userId, identity.userId));
  const seededOrders = orders.filter((row) =>
    (row.idempotencyKey ?? "").startsWith("dev-local:user:order:"),
  );
  assert.ok(seededOrders.length >= 3);
  await app.close();
});

test("POST /dev/auth rejects invalid role", async () => {
  const app = createApiApp({ db, authPolicy: policy, allowDevAuth: true });
  const denied = await app.inject({
    method: "POST",
    url: "/dev/auth",
    payload: { role: "superadmin" },
  });
  assert.equal(denied.statusCode, 400);
  await app.close();
});

test("every /dev/* route is 404 when allowDevAuth is false", async () => {
  const app = createApiApp({ db, authPolicy: policy, allowDevAuth: false });
  const routes = [
    "/dev/auth",
    "/dev/referrals/attribute",
    "/dev/referrals/qa-seed",
    "/dev/referrals/00000000-0000-0000-0000-000000000001/activate-kick",
    "/dev/tasks/evidence",
    "/dev/kick/link",
    "/dev/kick/stream/start",
    "/dev/kick/stream/end",
    "/dev/kick/chat/messages",
    "/dev/giveaways/00000000-0000-0000-0000-000000000001/draw-now",
    "/dev/achievements/evaluate",
  ];
  for (const url of routes) {
    const denied = await app.inject({
      method: "POST",
      url,
      payload: {},
    });
    assert.equal(denied.statusCode, 404, url);
  }
  await app.close();
});
