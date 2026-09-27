import {
  buildSignedInitData,
  createAuthPolicy,
} from "@giftbot/auth";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApiApp } from "./app.js";

const botToken = "123456:TEST-BOT-TOKEN-ACHIEVEMENTS";
const policy = createAuthPolicy(botToken);

let postgres: DevPostgres;
let sqlEnd: () => Promise<void>;
let db: ReturnType<typeof createDb>["db"];

before(async () => {
  postgres = await startDevPostgres({ port: 55511 });
  await runMigrations(postgres.url);
  const handle = createDb(postgres.url);
  db = handle.db;
  sqlEnd = async () => {
    await handle.sql.end({ timeout: 5 });
  };
});

after(async () => {
  if (typeof sqlEnd === "function") {
    await sqlEnd();
  }
  if (postgres) {
    await postgres.stop();
  }
});

function signedInitData(telegramUserId: number): string {
  return buildSignedInitData(
    botToken,
    {
      id: telegramUserId,
      first_name: "Achieve",
      username: `a${telegramUserId}`,
    },
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

test("GET /achievements requires auth and returns 5 catalog rows", async () => {
  const app = createApiApp({ db, authPolicy: policy });
  const denied = await app.inject({ method: "GET", url: "/achievements" });
  assert.equal(denied.statusCode, 401);

  const mini = await miniToken(99201);
  const ok = await app.inject({
    method: "GET",
    url: "/achievements",
    headers: { authorization: `Bearer ${mini.token}` },
  });
  assert.equal(ok.statusCode, 200);
  const body = ok.json() as {
    items: Array<{ code: string; target: number; rewardAzc: string }>;
  };
  assert.equal(body.items.length, 5);
  assert.ok(body.items.every((row) => row.code && row.rewardAzc));
  await app.close();
});
