import {
  buildSignedInitData,
  createAuthPolicy,
} from "@giftbot/auth";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import { createLocalSubmissionFileStorage, linkKickAccount } from "@giftbot/domain";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApiApp } from "./app.js";

const botToken = "123456:TEST-BOT-TOKEN-TASKS";
const policy = createAuthPolicy(botToken);

let postgres: DevPostgres;
let sqlEnd: () => Promise<void>;
let db: ReturnType<typeof createDb>["db"];
let storageRoot: string;

before(async () => {
  postgres = await startDevPostgres({ port: 55474 });
  await runMigrations(postgres.url);
  const handle = createDb(postgres.url);
  db = handle.db;
  sqlEnd = async () => {
    await handle.sql.end({ timeout: 5 });
  };
  storageRoot = await mkdtemp(join(tmpdir(), "giftbot-api-welvura-"));
});

after(async () => {
  await sqlEnd();
  await postgres.stop();
});

function pngBase64(): string {
  return Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
    "hex",
  ).toString("base64");
}

function signedInitData(telegramUserId: number, username?: string): string {
  return buildSignedInitData(
    botToken,
    {
      id: telegramUserId,
      first_name: "Task",
      ...(username ? { username } : {}),
    },
    Math.floor(Date.now() / 1000),
  );
}

async function miniToken(
  telegramUserId: number,
  username?: string,
): Promise<{ token: string; userId: string }> {
  const app = authApp();
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
    submissionStorage: createLocalSubmissionFileStorage(storageRoot),
  });
}

test("GET /tasks returns canonical catalog for session user", async () => {
  const app = authApp();
  const mini = await miniToken(97001, "tasker");
  const res = await app.inject({
    method: "GET",
    url: "/tasks",
    headers: { authorization: `Bearer ${mini.token}` },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as {
    tasks: Array<{ code: string; rewardAzc: string }>;
  };
  assert.equal(body.tasks.length, 6);
  const byCode = Object.fromEntries(
    body.tasks.map((t) => [t.code, t.rewardAzc]),
  );
  assert.equal(byCode.kick_link, "400");
  assert.equal(byCode.referral_3_active, "2000");
  await app.close();
});

test("claim kick_link after link; second claim replays", async () => {
  const app = authApp();
  const mini = await miniToken(97002, "kickclaim");
  await linkKickAccount(db, {
    userId: mini.userId,
    kickUserId: `kick-api-${mini.userId}`,
  });
  const first = await app.inject({
    method: "POST",
    url: "/tasks/kick_link/claim",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "task-kick-1",
    },
    payload: {},
  });
  assert.equal(first.statusCode, 200);
  assert.equal((first.json() as { rewardAzc: string }).rewardAzc, "400");
  const second = await app.inject({
    method: "POST",
    url: "/tasks/kick_link/claim",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "task-kick-2",
    },
    payload: {},
  });
  assert.equal(second.statusCode, 200);
  assert.equal((second.json() as { replayed: boolean }).replayed, true);
  await app.close();
});

test("welvura account submit and admin ACL", async () => {
  const app = authApp();
  const user = await miniToken(97003, "welvuser");
  const submit = await app.inject({
    method: "POST",
    url: "/welvura/account/submissions",
    headers: {
      authorization: `Bearer ${user.token}`,
      "idempotency-key": "welv-acc-1",
    },
    payload: {
      welvuraId: "WIDAPI1",
      contentType: "image/png",
      screenshotBase64: pngBase64(),
    },
  });
  assert.equal(submit.statusCode, 200);

  const denied = await app.inject({
    method: "GET",
    url: "/admin/welvura/account-submissions?status=pending",
    headers: { authorization: `Bearer ${user.token}` },
  });
  assert.ok(denied.statusCode === 401 || denied.statusCode === 403);

  const state = await app.inject({
    method: "GET",
    url: "/welvura",
    headers: { authorization: `Bearer ${user.token}` },
  });
  assert.equal(state.statusCode, 200);
  assert.equal(
    (state.json() as { account: { state: string; rewardAzc: string } }).account
      .state,
    "pending",
  );
  assert.equal(
    (state.json() as { account: { rewardAzc: string } }).account.rewardAzc,
    "1000",
  );
  await app.close();
});

test("dev task evidence is 404 when allowDevAuth false", async () => {
  const app = createApiApp({
    db,
    authPolicy: policy,
    allowDevAuth: false,
    submissionStorage: createLocalSubmissionFileStorage(storageRoot),
  });
  const res = await app.inject({
    method: "POST",
    url: "/dev/tasks/evidence",
    payload: { botStarted: true },
  });
  assert.equal(res.statusCode, 404);
  await app.close();
});
