import {
  buildSignedInitData,
  createAuthPolicy,
} from "@giftbot/auth";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import { games, inboundEvents, jobs, telegramAccounts } from "@giftbot/db/schema";
import { apply } from "@giftbot/domain";
import { JOB_TYPES } from "@giftbot/jobs";
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
  postgres = await startDevPostgres({ port: 55441 });
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
    { id: telegramUserId, first_name: "Play" },
    Math.floor(Date.now() / 1000),
  );
}

async function authToken(telegramUserId: number): Promise<string> {
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

test("GET /games is read-only and empty without a catalog", async () => {
  const token = await authToken(91001);
  const inboundBefore = (await db.select().from(inboundEvents)).length;
  const jobsBefore = (await db.select().from(jobs)).length;
  const app = createApiApp({ db, authPolicy: policy });
  const listed = await app.inject({
    method: "GET",
    url: "/games",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json(), { games: [] });
  assert.equal((await db.select().from(inboundEvents)).length, inboundBefore);
  assert.equal((await db.select().from(jobs)).length, jobsBefore);
  await app.close();
});

test("POST play rejects a client-supplied result and accepts a catalog bet", async () => {
  const token = await authToken(91002);
  const telegram = (
    await db.select().from(telegramAccounts)
  ).find((row) => row.telegramUserId === 91002n);
  assert.ok(telegram);
  await apply(db, {
    userId: telegram.userId,
    type: "deposit",
    amountMinor: 20n,
    idempotencyKey: `deposit:${telegram.userId}:api-play`,
    actorType: "system",
  });
  const [game] = await db
    .insert(games)
    .values({
      slug: "api-instant",
      title: "api instant",
      settlementMode: "instant",
      status: "active",
      config: { allowedBetMinor: ["5"], prizeMinor: "1" },
    })
    .returning();
  assert.ok(game);

  const app = createApiApp({ db, authPolicy: policy });
  const forbidden = await app.inject({
    method: "POST",
    url: `/games/${game.id}/play`,
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": "play-client-result",
    },
    payload: { betAmountMinor: "5", result: "win", prizeMinor: "999" },
  });
  assert.equal(forbidden.statusCode, 400);

  const played = await app.inject({
    method: "POST",
    url: `/games/${game.id}/play`,
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": "play-ok-1",
    },
    payload: { betAmountMinor: "5" },
  });
  assert.equal(played.statusCode, 200);
  const body = played.json() as {
    roundId: string;
    status: string;
    result?: { draw?: string };
  };
  assert.equal(body.status, "settled");
  assert.ok(body.result?.draw);
  assert.notEqual(body.result?.draw, "win");

  const replay = await app.inject({
    method: "POST",
    url: `/games/${game.id}/play`,
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": "play-ok-1",
    },
    payload: { betAmountMinor: "5" },
  });
  assert.equal(replay.statusCode, 200);
  assert.equal((replay.json() as { roundId: string }).roundId, body.roundId);
  await app.close();
});

test("GET /rounds does not settle an async game", async () => {
  const token = await authToken(91003);
  const telegram = (
    await db.select().from(telegramAccounts)
  ).find((row) => row.telegramUserId === 91003n);
  assert.ok(telegram);
  await apply(db, {
    userId: telegram.userId,
    type: "deposit",
    amountMinor: 10n,
    idempotencyKey: `deposit:${telegram.userId}:api-async`,
    actorType: "system",
  });
  const [game] = await db
    .insert(games)
    .values({
      slug: "api-async",
      title: "api async",
      settlementMode: "async",
      status: "active",
      config: { allowedBetMinor: ["2"], prizeMinor: "1" },
    })
    .returning();
  assert.ok(game);

  const app = createApiApp({ db, authPolicy: policy });
  const accepted = await app.inject({
    method: "POST",
    url: `/games/${game.id}/play`,
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": "async-play-1",
    },
    payload: { betAmountMinor: "2" },
  });
  assert.equal(accepted.statusCode, 200);
  const acceptedBody = accepted.json() as { roundId: string; status: string };
  assert.equal(acceptedBody.status, "pending");

  const jobRows = await db
    .select()
    .from(jobs)
    .where(eq(jobs.type, JOB_TYPES.gameSettleAsync));
  assert.equal(jobRows.length, 1);
  assert.equal(jobRows[0]?.owner, "worker");

  const viewed = await app.inject({
    method: "GET",
    url: `/rounds/${acceptedBody.roundId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(viewed.statusCode, 200);
  assert.equal((viewed.json() as { status: string }).status, "pending");
  await app.close();
});

test("referral payout is disabled", async () => {
  const token = await authToken(91004);
  const app = createApiApp({ db, authPolicy: policy });
  const response = await app.inject({
    method: "POST",
    url: "/referrals/payout",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.statusCode, 409);
  await app.close();
});
