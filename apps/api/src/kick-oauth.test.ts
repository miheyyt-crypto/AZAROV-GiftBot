import {
  buildSignedInitData,
  createAuthPolicy,
} from "@giftbot/auth";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import { kickAccounts, kickOauthStates, walletTransactions } from "@giftbot/db/schema";
import { parseTokenEncryptionKey, type KickOAuthClient } from "@giftbot/domain";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApiApp } from "./app.js";

const botToken = "123456:TEST-BOT-TOKEN";
const policy = createAuthPolicy(botToken);
const encryptionKey = parseTokenEncryptionKey("cd".repeat(32));

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
    { id: telegramUserId, first_name: "Kick" },
    Math.floor(Date.now() / 1000),
  );
}

function fakeClient(
  kickUserId: string,
  profile: { username?: string; displayName?: string; avatarUrl?: string } = {},
): KickOAuthClient & { exchanges: number } {
  const client = {
    exchanges: 0,
    async exchangeAuthorizationCode() {
      client.exchanges += 1;
      return {
        accessToken: "kick-access",
        refreshToken: "kick-refresh",
        expiresIn: 3600,
        scope: "user:read",
        kickUserId,
        ...profile,
      };
    },
    async refreshAccessToken() {
      return {
        accessToken: "kick-access-2",
        refreshToken: "kick-refresh-2",
        expiresIn: 3600,
      };
    },
  };
  return client;
}

test("OAuth start is not GET and requires a session", async () => {
  const app = createApiApp({
    db,
    authPolicy: policy,
    kickOAuth: {
      clientId: "client",
      redirectUri: "http://127.0.0.1:3000/kick/oauth/callback",
      encryptionKey,
      client: fakeClient("kick-api-user-1"),
    },
  });
  const getStart = await app.inject({ method: "GET", url: "/kick/oauth/start" });
  assert.ok(getStart.statusCode === 404 || getStart.statusCode === 405);

  const unauth = await app.inject({ method: "POST", url: "/kick/oauth/start" });
  assert.equal(unauth.statusCode, 401);
  await app.close();
});

test("POST start + callback links Kick once and does not write money", async () => {
  const client = fakeClient("kick-api-user-2", {
    username: "kickname",
    displayName: "Kick Name",
    avatarUrl: "https://images.kick.com/ok.png",
  });
  const app = createApiApp({
    db,
    authPolicy: policy,
    kickOAuth: {
      clientId: "client",
      redirectUri: "http://127.0.0.1:3000/kick/oauth/callback",
      encryptionKey,
      client,
    },
  });
  const auth = await app.inject({
    method: "POST",
    url: "/auth/telegram",
    payload: { initData: signedInitData(99101) },
  });
  const token = (auth.json() as { token: string }).token;

  const started = await app.inject({
    method: "POST",
    url: "/kick/oauth/start",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(started.statusCode, 200);
  const startedBody = started.json() as { authorizationUrl: string };
  const url = new URL(startedBody.authorizationUrl);
  assert.equal(url.hostname, "id.kick.com");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const state = url.searchParams.get("state");
  assert.ok(state);

  const statesBefore = (
    await db.select().from(kickOauthStates).where(eq(kickOauthStates.state, state))
  )[0];
  assert.equal(statesBefore?.consumedAt, null);

  const callback = await app.inject({
    method: "GET",
    url: `/kick/oauth/callback?code=auth-code-1&state=${encodeURIComponent(state)}`,
  });
  assert.equal(callback.statusCode, 200);
  assert.deepEqual(callback.json(), { ok: true, kickLinked: true });
  assert.equal(client.exchanges, 1);

  const replay = await app.inject({
    method: "GET",
    url: `/kick/oauth/callback?code=auth-code-1&state=${encodeURIComponent(state)}`,
  });
  assert.equal(replay.statusCode, 404);
  assert.equal(client.exchanges, 1);

  const bootstrap = await app.inject({
    method: "GET",
    url: "/bootstrap",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(bootstrap.statusCode, 200);
  assert.equal(bootstrap.json().flags.kickLinked, true);

  const accounts = await db
    .select()
    .from(kickAccounts)
    .where(eq(kickAccounts.kickUserId, "kick-api-user-2"));
  assert.equal(accounts.length, 1);
  assert.ok(accounts[0]?.accessTokenEncrypted?.startsWith("v1:"));
  assert.notEqual(accounts[0]?.accessTokenEncrypted, "kick-access");
  assert.equal(accounts[0]?.username, "kickname");
  assert.equal(accounts[0]?.displayName, "Kick Name");
  assert.equal(accounts[0]?.avatarUrl, "https://images.kick.com/ok.png");

  const profile = await app.inject({
    method: "GET",
    url: "/profile",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(profile.statusCode, 200);
  const profileBody = profile.json() as {
    integrations: {
      kick: {
        linked: boolean;
        username: string | null;
        displayName: string | null;
        avatarUrl: string | null;
      };
    };
  };
  assert.equal(profileBody.integrations.kick.linked, true);
  assert.equal(profileBody.integrations.kick.username, "kickname");
  assert.equal(profileBody.integrations.kick.displayName, "Kick Name");
  assert.equal(profileBody.integrations.kick.avatarUrl, "https://images.kick.com/ok.png");

  const ledger = await db.select().from(walletTransactions);
  assert.equal(
    ledger.filter((row) => row.userId === accounts[0]?.userId).length,
    0,
  );
  await app.close();
});

test("POST /kick/oauth/start is 503 when Kick OAuth is not configured", async () => {
  const app = createApiApp({ db, authPolicy: policy });
  const auth = await app.inject({
    method: "POST",
    url: "/auth/telegram",
    payload: { initData: signedInitData(99102) },
  });
  const token = (auth.json() as { token: string }).token;
  const started = await app.inject({
    method: "POST",
    url: "/kick/oauth/start",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(started.statusCode, 503);
  await app.close();
});
