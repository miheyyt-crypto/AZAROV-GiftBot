import {
  buildSignedInitData,
  createAuthPolicy,
} from "@giftbot/auth";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import {
  adminRoleAssignments,
  adminRoles,
  kickAccounts,
} from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApiApp } from "./app.js";

const botToken = "123456:TEST-BOT-TOKEN-GIVEAWAY";
const policy = createAuthPolicy(botToken);

let postgres: DevPostgres;
let sqlEnd: () => Promise<void>;
let db: ReturnType<typeof createDb>["db"];

before(async () => {
  postgres = await startDevPostgres({ port: 55510 });
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
      first_name: "Give",
      username: `g${telegramUserId}`,
    },
    Math.floor(Date.now() / 1000),
  );
}

async function assignSuperAdmin(userId: string): Promise<void> {
  const roles = await db
    .select()
    .from(adminRoles)
    .where(eq(adminRoles.name, "super_admin"))
    .limit(1);
  const role = roles[0];
  assert.ok(role);
  await db.insert(adminRoleAssignments).values({
    userId,
    roleId: role.id,
  });
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

async function adminToken(telegramUserId: number): Promise<{
  token: string;
  userId: string;
}> {
  const mini = await miniToken(telegramUserId);
  await assignSuperAdmin(mini.userId);
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: "/admin/auth",
    payload: { initData: signedInitData(telegramUserId) },
  });
  assert.equal(created.statusCode, 200);
  const body = created.json() as { token: string };
  await app.close();
  return { token: body.token, userId: mini.userId };
}

async function linkKick(userId: string, kickUserId: string): Promise<void> {
  await db.insert(kickAccounts).values({
    userId,
    kickUserId,
    status: "active",
  });
}

test("admin giveaway ACL requires super_admin session", async () => {
  const mini = await miniToken(99101);
  const app = createApiApp({ db, authPolicy: policy });
  const denied = await app.inject({
    method: "GET",
    url: "/admin/giveaways",
    headers: { authorization: `Bearer ${mini.token}` },
  });
  assert.equal(denied.statusCode, 401);

  const admin = await adminToken(99102);
  const listed = await app.inject({
    method: "GET",
    url: "/admin/giveaways",
    headers: { authorization: `Bearer ${admin.token}` },
  });
  assert.equal(listed.statusCode, 200);
  assert.ok(Array.isArray((listed.json() as { items: unknown[] }).items));
  await app.close();
});

test("create rejects injected winner fields; join validates eligibility", async () => {
  const admin = await adminToken(99103);
  const user = await miniToken(99104);
  const app = createApiApp({ db, authPolicy: policy });

  const injected = await app.inject({
    method: "POST",
    url: "/admin/giveaways",
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "gw-create-inj",
    },
    payload: {
      title: "Hack",
      type: "coins",
      bankAzc: "1000",
      winnerCount: 1,
      endsAt: new Date(Date.now() + 60_000).toISOString(),
      reason: "test",
      winners: [{ userId: user.userId }],
      forceWinner: user.userId,
      actualWinnerCount: 1,
    },
  });
  assert.equal(injected.statusCode, 400);

  const created = await app.inject({
    method: "POST",
    url: "/admin/giveaways",
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "gw-create-1",
    },
    payload: {
      title: "Coins giveaway",
      type: "coins",
      bankAzc: "1000",
      winnerCount: 1,
      endsAt: new Date(Date.now() + 120_000).toISOString(),
      reason: "create for join smoke",
    },
  });
  assert.equal(created.statusCode, 200, JSON.stringify(created.json()));
  const giveawayId = (created.json() as { id: string }).id;

  const activated = await app.inject({
    method: "POST",
    url: `/admin/giveaways/${giveawayId}/activate`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "gw-activate-1",
    },
    payload: { reason: "open for join" },
  });
  assert.equal(activated.statusCode, 200, JSON.stringify(activated.json()));
  assert.equal((activated.json() as { status: string }).status, "open");

  const joinInjected = await app.inject({
    method: "POST",
    url: `/giveaways/${giveawayId}/join`,
    headers: {
      authorization: `Bearer ${user.token}`,
      "idempotency-key": "gw-join-inj",
    },
    payload: { winners: [], payout: "999", forceWinner: true },
  });
  assert.equal(joinInjected.statusCode, 400);

  const noKick = await app.inject({
    method: "POST",
    url: `/giveaways/${giveawayId}/join`,
    headers: {
      authorization: `Bearer ${user.token}`,
      "idempotency-key": "gw-join-nokick",
    },
    payload: {},
  });
  assert.equal(noKick.statusCode, 409);
  assert.equal(
    (noKick.json() as { error: string }).error,
    "GIVEAWAY_NOT_ELIGIBLE",
  );

  await linkKick(user.userId, `kick-${user.userId}`);

  const joined = await app.inject({
    method: "POST",
    url: `/giveaways/${giveawayId}/join`,
    headers: {
      authorization: `Bearer ${user.token}`,
      "idempotency-key": "gw-join-1",
    },
    payload: {},
  });
  assert.equal(joined.statusCode, 200, JSON.stringify(joined.json()));
  assert.equal((joined.json() as { replayed: boolean }).replayed, false);

  const replay = await app.inject({
    method: "POST",
    url: `/giveaways/${giveawayId}/join`,
    headers: {
      authorization: `Bearer ${user.token}`,
      "idempotency-key": "gw-join-1",
    },
    payload: {},
  });
  assert.equal(replay.statusCode, 200);
  assert.equal((replay.json() as { replayed: boolean }).replayed, true);

  const listed = await app.inject({
    method: "GET",
    url: "/giveaways?tab=active",
    headers: { authorization: `Bearer ${user.token}` },
  });
  assert.equal(listed.statusCode, 200);
  const items = (listed.json() as { items: Array<{ id: string; joined: boolean }> })
    .items;
  assert.ok(items.some((row) => row.id === giveawayId && row.joined));

  const detail = await app.inject({
    method: "GET",
    url: `/giveaways/${giveawayId}`,
    headers: { authorization: `Bearer ${user.token}` },
  });
  assert.equal(detail.statusCode, 200);
  assert.equal((detail.json() as { joined: boolean }).joined, true);
  assert.equal((detail.json() as { imageUrl: string | null }).imageUrl, null);

  await app.close();
});

test("admin giveaway image upload requires admin and stores public url", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const uploadDir = await mkdtemp(join(tmpdir(), "gb-api-gw-img-"));
  const mini = await miniToken(99201);
  const admin = await adminToken(99202);
  const app = createApiApp({ db, authPolicy: policy, uploadDir });

  const denied = await app.inject({
    method: "POST",
    url: "/admin/giveaways/media",
    headers: { authorization: `Bearer ${mini.token}` },
    payload: {
      contentType: "image/png",
      imageBase64: png.toString("base64"),
    },
  });
  assert.equal(denied.statusCode, 401);

  const invalid = await app.inject({
    method: "POST",
    url: "/admin/giveaways/media",
    headers: { authorization: `Bearer ${admin.token}` },
    payload: {
      contentType: "image/png",
      imageBase64: Buffer.from("hello").toString("base64"),
    },
  });
  assert.equal(invalid.statusCode, 400);

  const uploaded = await app.inject({
    method: "POST",
    url: "/admin/giveaways/media",
    headers: { authorization: `Bearer ${admin.token}` },
    payload: {
      contentType: "image/png",
      imageBase64: png.toString("base64"),
    },
  });
  assert.equal(uploaded.statusCode, 200, JSON.stringify(uploaded.json()));
  const imageUrl = (uploaded.json() as { imageUrl: string }).imageUrl;
  assert.match(imageUrl, /^\/giveaways\/media\/[0-9a-f-]+\.png$/i);
  assert.doesNotMatch(imageUrl, /uploadDir|tmp|\\\\|C:\\\\/i);

  const created = await app.inject({
    method: "POST",
    url: "/admin/giveaways",
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "gw-img-create",
    },
    payload: {
      title: "Photo raffle",
      type: "coins",
      bankAzc: "1000",
      winnerCount: 1,
      endsAt: new Date(Date.now() + 60_000).toISOString(),
      reason: "with image",
      imageUrl,
    },
  });
  assert.equal(created.statusCode, 200, JSON.stringify(created.json()));
  assert.equal((created.json() as { imageUrl: string }).imageUrl, imageUrl);

  await app.inject({
    method: "POST",
    url: `/admin/giveaways/${(created.json() as { id: string }).id}/activate`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "gw-img-act",
    },
    payload: { reason: "open" },
  });

  const listed = await app.inject({
    method: "GET",
    url: "/giveaways?tab=active",
    headers: { authorization: `Bearer ${mini.token}` },
  });
  assert.equal(listed.statusCode, 200);
  const items = listed.json() as { items: Array<{ imageUrl: string | null; title: string }> };
  const row = items.items.find((item) => item.title === "Photo raffle");
  assert.ok(row);
  assert.equal(row.imageUrl, imageUrl);
  assert.doesNotMatch(JSON.stringify(listed.json()), /storageKey|absolutePath|UPLOAD_DIR/);

  const media = await app.inject({
    method: "GET",
    url: imageUrl,
  });
  assert.equal(media.statusCode, 200);
  assert.equal(media.headers["content-type"], "image/png");
  assert.ok(Buffer.isBuffer(media.rawPayload) || media.payload.length > 0);

  await app.close();
  await rm(uploadDir, { recursive: true, force: true });
});
