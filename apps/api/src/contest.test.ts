import { buildSignedInitData, createAuthPolicy } from "@giftbot/auth";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import { ensureDefaultReferralContest } from "@giftbot/domain";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApiApp } from "./app.js";

const botToken = "123456:TEST-BOT-TOKEN-CONTEST";
const policy = createAuthPolicy(botToken);

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

test("GET contest summary requires Mini App auth", async () => {
  const app = createApiApp({ db, authPolicy: policy });
  const summary = await app.inject({ method: "GET", url: "/contest/referral/summary" });
  const page = await app.inject({ method: "GET", url: "/contest/referral" });
  assert.equal(summary.statusCode, 401);
  assert.equal(page.statusCode, 404);
  await app.close();
});

test("home summary is read-only and includes prizes, TOP 5 and me", async () => {
  const created = await ensureDefaultReferralContest(db);
  const mini = await miniToken(93101);
  const app = createApiApp({
    db,
    authPolicy: policy,
    telegramBotUsername: "AZAROV_GiftBot",
  });
  const summary = await app.inject({
    method: "GET",
    url: "/contest/referral/summary",
    headers: { authorization: `Bearer ${mini.token}` },
  });
  assert.equal(summary.statusCode, 200);
  const body = summary.json() as {
    contest: { id: string; prizes: unknown[]; serverNow: string } | null;
    leaderboard: unknown[];
    me: { rank: number; referralCount: number; referralUrl: string | null };
  };
  assert.equal(body.contest?.id, created.id);
  assert.equal(body.contest?.prizes.length, 5);
  assert.equal(
    (body.contest?.prizes as { rewardAzc: string }[] | undefined)?.[0]?.rewardAzc,
    "50000",
  );
  assert.ok(Array.isArray(body.leaderboard));
  assert.ok(body.leaderboard.length <= 5);
  assert.match(String(body.me.referralUrl), /t\.me\/AZAROV_GiftBot\?start=/);

  const again = await ensureDefaultReferralContest(db);
  assert.equal(again.id, created.id);
  assert.equal(again.startAt, created.startAt);

  const adminGone = await app.inject({
    method: "POST",
    url: "/admin/contest/referral",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "contest-create-1",
    },
    payload: { startNow: true },
  });
  assert.equal(adminGone.statusCode, 404);
  await app.close();
});
