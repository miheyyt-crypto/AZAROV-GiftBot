import {
  buildSignedInitData,
  createAuthPolicy,
} from "@giftbot/auth";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApiApp } from "./app.js";

const botToken = "123456:TEST-BOT-TOKEN-ROLLS";
const policy = createAuthPolicy(botToken);

let postgres: DevPostgres;
let sqlEnd: () => Promise<void>;
let db: ReturnType<typeof createDb>["db"];

before(async () => {
  postgres = await startDevPostgres({ port: 55488 });
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
    { id: telegramUserId, first_name: "Rolls", username: `r${telegramUserId}` },
    Math.floor(Date.now() / 1000),
  );
}

async function miniToken(telegramUserId: number): Promise<string> {
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: "/auth/telegram",
    payload: { initData: signedInitData(telegramUserId) },
  });
  const body = created.json() as { token: string };
  await app.close();
  return body.token;
}

test("GET /games/rolls/current and POST bet reject injected outcome fields", async () => {
  const app = createApiApp({ db, authPolicy: policy });
  const denied = await app.inject({ method: "GET", url: "/games/rolls/current" });
  assert.equal(denied.statusCode, 401);

  const token = await miniToken(99101);
  const current = await app.inject({
    method: "GET",
    url: "/games/rolls/current",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(current.statusCode, 200);
  const body = current.json() as {
    round: {
      status: string;
      serverSeed: string | null;
      spinDurationMs: number;
    };
    previous: unknown;
    top: unknown;
  };
  assert.ok(["waiting", "betting", "spinning", "resolved"].includes(body.round.status));
  assert.equal(body.round.serverSeed, null);
  assert.equal(body.round.spinDurationMs, 8000);
  assert.ok("previous" in body);
  assert.ok("top" in body);

  const rejected = await app.inject({
    method: "POST",
    url: "/games/rolls/bet",
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": "bad-fields",
    },
    payload: {
      amountAzc: 100,
      clientSeed: "abc",
      winningTicket: 1,
      serverSeed: "nope",
    },
  });
  assert.equal(rejected.statusCode, 400);

  await app.close();
});
