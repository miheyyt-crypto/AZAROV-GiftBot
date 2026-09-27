import {
  buildSignedInitData,
  createAuthPolicy,
} from "@giftbot/auth";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApiApp } from "./app.js";

const botToken = "123456:TEST-BOT-TOKEN-STREAK";
const policy = createAuthPolicy(botToken);

let postgres: DevPostgres;
let sqlEnd: () => Promise<void>;
let db: ReturnType<typeof createDb>["db"];

before(async () => {
  postgres = await startDevPostgres({ port: 55476 });
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

function authApp() {
  return createApiApp({
    db,
    authPolicy: policy,
    allowDevAuth: true,
  });
}

async function miniToken(telegramUserId: number): Promise<string> {
  const app = authApp();
  const created = await app.inject({
    method: "POST",
    url: "/auth/telegram",
    payload: {
      initData: buildSignedInitData(
        botToken,
        { id: telegramUserId, first_name: "Streak" },
        Math.floor(Date.now() / 1000),
      ),
    },
  });
  const body = created.json() as { token: string };
  await app.close();
  return body.token;
}

test("GET /stream-streak returns default offline state", async () => {
  const token = await miniToken(88001);
  const app = authApp();
  const res = await app.inject({
    method: "GET",
    url: "/stream-streak",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as {
    currentStreak: number;
    completed: boolean;
    nextTarget: number | null;
    nextRewardAzc: string | null;
    freezeCount: number;
    stream: { isLive: boolean };
  };
  assert.equal(body.currentStreak, 0);
  assert.equal(body.completed, false);
  assert.equal(body.nextTarget, 1);
  assert.equal(body.nextRewardAzc, "100");
  assert.equal(body.stream.isLive, false);
  await app.close();
});

test("DEV kick stream simulation awards XP and streak", async () => {
  const token = await miniToken(88002);
  const app = authApp();
  const headers = { authorization: `Bearer ${token}` };

  const start = await app.inject({
    method: "POST",
    url: "/dev/kick/stream/start",
    headers,
    payload: { providerStreamId: "api-dev-stream-1" },
  });
  assert.equal(start.statusCode, 200);

  const nine = await app.inject({
    method: "POST",
    url: "/dev/kick/chat/messages",
    headers,
    payload: { count: 9 },
  });
  assert.equal(nine.statusCode, 200);
  const nineBody = nine.json() as {
    streak: { currentStreak: number; stream: { messages: number } };
  };
  assert.equal(nineBody.streak.currentStreak, 0);
  assert.equal(nineBody.streak.stream.messages, 9);

  const tenth = await app.inject({
    method: "POST",
    url: "/dev/kick/chat/messages",
    headers,
    payload: { count: 1, messageId: "api-dev-msg-10" },
  });
  assert.equal(tenth.statusCode, 200);
  const tenthBody = tenth.json() as {
    streak: { currentStreak: number; stream: { qualified: boolean } };
  };
  assert.equal(tenthBody.streak.currentStreak, 1);
  assert.equal(tenthBody.streak.stream.qualified, true);

  const replay = await app.inject({
    method: "POST",
    url: "/dev/kick/chat/messages",
    headers,
    payload: { count: 1, messageId: "api-dev-msg-10" },
  });
  assert.equal(replay.statusCode, 200);
  const replayBody = replay.json() as {
    streak: { currentStreak: number };
    results: Array<{ replayed: boolean }>;
  };
  assert.equal(replayBody.results[0]?.replayed, true);
  assert.equal(replayBody.streak.currentStreak, 1);

  const end = await app.inject({
    method: "POST",
    url: "/dev/kick/stream/end",
    headers,
  });
  assert.equal(end.statusCode, 200);

  const streak = await app.inject({
    method: "GET",
    url: "/stream-streak",
    headers,
  });
  assert.equal(streak.statusCode, 200);
  const streakBody = streak.json() as {
    currentStreak: number;
    stream: { isLive: boolean };
  };
  assert.equal(streakBody.currentStreak, 1);
  assert.equal(streakBody.stream.isLive, false);
  await app.close();
});
