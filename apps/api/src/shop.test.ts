import {
  buildSignedInitData,
  createAuthPolicy,
} from "@giftbot/auth";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import {
  adminRoleAssignments,
  adminRoles,
  auditLogs,
  inventoryItems,
  purchases,
  walletTransactions,
} from "@giftbot/db/schema";
import { apply, asBigInt, ensureShopCatalog } from "@giftbot/domain";
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
  postgres = await startDevPostgres({ port: 55451 });
  await runMigrations(postgres.url);
  const handle = createDb(postgres.url);
  db = handle.db;
  await ensureShopCatalog(db);
  sqlEnd = async () => {
    await handle.sql.end({ timeout: 5 });
  };
});

after(async () => {
  await sqlEnd();
  await postgres.stop();
});

function signedInitData(telegramUserId: number, username?: string): string {
  return buildSignedInitData(
    botToken,
    {
      id: telegramUserId,
      first_name: "Shop",
      ...(username ? { username } : {}),
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

async function credit(userId: string, amount: bigint, key: string): Promise<void> {
  await apply(db, {
    userId,
    type: "deposit",
    amountMinor: amount,
    idempotencyKey: key,
    actorType: "system",
  });
}

test("POST /shop/orders requires auth", async () => {
  const app = createApiApp({ db, authPolicy: policy });
  const response = await app.inject({
    method: "POST",
    url: "/shop/orders",
    headers: { "idempotency-key": "no-auth" },
    payload: { productCode: "donat", submittedData: {} },
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("GET /shop/catalog returns canonical approved prices", async () => {
  const mini = await miniToken(96001);
  const app = createApiApp({ db, authPolicy: policy });
  const response = await app.inject({
    method: "GET",
    url: "/shop/catalog",
    headers: { authorization: `Bearer ${mini.token}` },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    items: Array<{ code: string; priceAzc: string; title: string }>;
  };
  const byCode = Object.fromEntries(
    body.items.map((item) => [item.code, item.priceAzc]),
  );
  assert.equal(byCode["welvura-200"], "11111");
  assert.equal(byCode["welvura-500"], "22222");
  assert.equal(byCode["welvura-5000"], "199999");
  assert.equal(byCode["donat"], "1000");
  assert.equal(byCode["gif-stream"], "1000");
  assert.equal(byCode["music"], "4000");
  assert.equal(byCode["streak-freeze"], "1000");
  assert.equal(byCode["vip-kick"], "149999");
  assert.equal(byCode["welvura-bonus-3000"], "77777");
  assert.equal(byCode["custom-slot"], "5555");
  assert.equal(byCode["premium-6"], undefined);
  assert.equal(byCode["premium-12"], undefined);
  assert.equal(body.items.length, 10);
  assert.deepEqual(
    body.items.map((item) => item.code),
    [
      "welvura-200",
      "welvura-500",
      "welvura-5000",
      "welvura-bonus-3000",
      "donat",
      "gif-stream",
      "music",
      "custom-slot",
      "streak-freeze",
      "vip-kick",
    ],
  );
  assert.ok(!body.items.some((item) => "admin" in item));
  await app.close();
});

test("purchase validation is strict per product type", async () => {
  const mini = await miniToken(96002);
  await credit(mini.userId, 1_000_000n, `deposit:${mini.userId}:validate`);
  const app = createApiApp({ db, authPolicy: policy });
  const cases = [
    {
      key: "bad-welvura",
      payload: {
        productCode: "welvura-200",
        submittedData: { welvuraId: "<script>" },
      },
      error: "SHOP_INVALID_WELVURA_ID",
    },
    {
      key: "bad-kick",
      payload: {
        productCode: "vip-kick",
        submittedData: { kickUsername: "t.me/bad" },
      },
      error: "SHOP_INVALID_KICK_USERNAME",
    },
    {
      key: "bad-donat-nick",
      payload: {
        productCode: "donat",
        submittedData: { displayNickname: "", donationText: "hi" },
      },
      error: "SHOP_INVALID_DONATION_NICKNAME",
    },
    {
      key: "bad-donat-text",
      payload: {
        productCode: "donat",
        submittedData: { displayNickname: "ok", donationText: "x".repeat(301) },
      },
      error: "SHOP_INVALID_DONATION_TEXT",
    },
    {
      key: "bad-music",
      payload: {
        productCode: "music",
        submittedData: { mediaUrl: "https://example.com/song" },
      },
      error: "SHOP_INVALID_MEDIA_URL",
    },
    {
      key: "bonus-missing-id",
      payload: {
        productCode: "welvura-bonus-3000",
        submittedData: { slotName: "Sweet Bonanza" },
      },
      error: "SHOP_INVALID_WELVURA_ID",
    },
    {
      key: "bonus-missing-slot",
      payload: {
        productCode: "welvura-bonus-3000",
        submittedData: { welvuraId: "123456", slotName: "  " },
      },
      error: "SHOP_INVALID_SLOT_NAME",
    },
    {
      key: "custom-missing-slot",
      payload: {
        productCode: "custom-slot",
        submittedData: {},
      },
      error: "SHOP_INVALID_SLOT_NAME",
    },
  ];
  for (const row of cases) {
    const response = await app.inject({
      method: "POST",
      url: "/shop/orders",
      headers: {
        authorization: `Bearer ${mini.token}`,
        "idempotency-key": row.key,
      },
      payload: row.payload,
    });
    assert.equal(response.statusCode, 400);
    assert.equal((response.json() as { error: string }).error, row.error);
    assert.doesNotMatch(
      (response.json() as { message: string }).message,
      /SQL|23505|postgres/i,
    );
  }
  await app.close();
});

test("insufficient balance is SHOP_INSUFFICIENT_BALANCE", async () => {
  const mini = await miniToken(96003);
  await credit(mini.userId, 10n, `deposit:${mini.userId}:low`);
  const app = createApiApp({ db, authPolicy: policy });
  const response = await app.inject({
    method: "POST",
    url: "/shop/orders",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "shop-low",
    },
    payload: {
      productCode: "donat",
      submittedData: { displayNickname: "Nick", donationText: "hello" },
    },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(
    (response.json() as { error: string }).error,
    "SHOP_INSUFFICIENT_BALANCE",
  );
  await app.close();
});

test("manual purchase uses catalog price and ignores injected fields", async () => {
  const mini = await miniToken(96004);
  await credit(mini.userId, 20_000n, `deposit:${mini.userId}:manual`);
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: "/shop/orders",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "shop-manual",
    },
    payload: {
      productCode: "welvura-200",
      submittedData: { welvuraId: "WID123" },
      priceAzc: "1",
      price: 1,
      userId: "00000000-0000-4000-8000-000000000099",
      status: "fulfilled",
      productName: "hacked",
    },
  });
  assert.equal(created.statusCode, 200);
  const body = created.json() as {
    status: string;
    orderId: string;
    productCode: string;
    priceAzc: string;
    newBalanceAzc: string;
  };
  assert.equal(body.status, "pending");
  assert.equal(body.productCode, "welvura-200");
  assert.equal(body.priceAzc, "11111");
  assert.equal(body.newBalanceAzc, "8889");

  const replay = await app.inject({
    method: "POST",
    url: "/shop/orders",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "shop-manual",
    },
    payload: {
      productCode: "welvura-200",
      submittedData: { welvuraId: "WID123" },
    },
  });
  assert.equal(replay.statusCode, 200);
  assert.equal((replay.json() as { orderId: string }).orderId, body.orderId);
  assert.equal((replay.json() as { replayed: boolean }).replayed, true);

  const orders = await db
    .select()
    .from(purchases)
    .where(eq(purchases.userId, mini.userId));
  assert.equal(orders.length, 1);
  const ledger = await db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, mini.userId));
  assert.equal(ledger.filter((row) => row.type === "shop_purchase").length, 1);
  await app.close();
});

test("streak freeze purchase is fulfilled immediately and grants inventory", async () => {
  const mini = await miniToken(96005);
  await credit(mini.userId, 2000n, `deposit:${mini.userId}:freeze`);
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: "/shop/orders",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "shop-freeze",
    },
    payload: { productCode: "streak-freeze", submittedData: {} },
  });
  assert.equal(created.statusCode, 200);
  const body = created.json() as {
    status: string;
    productCode: string;
    priceAzc: string;
    inventoryGranted?: { type: string; quantity: number };
  };
  assert.equal(body.status, "fulfilled");
  assert.equal(body.productCode, "streak-freeze");
  assert.equal(body.priceAzc, "1000");
  assert.deepEqual(body.inventoryGranted, {
    type: "streak_freeze",
    quantity: 1,
  });
  const items = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.userId, mini.userId));
  assert.equal(items.length, 1);
  assert.equal(items[0]?.quantity, 1);
  await app.close();
});

test("unknown product is rejected and users see only their own orders", async () => {
  const first = await miniToken(96006);
  const second = await miniToken(96007);
  await credit(first.userId, 2000n, `deposit:${first.userId}:own`);
  const app = createApiApp({ db, authPolicy: policy });
  const unknown = await app.inject({
    method: "POST",
    url: "/shop/orders",
    headers: {
      authorization: `Bearer ${first.token}`,
      "idempotency-key": "shop-unknown",
    },
    payload: { productCode: "nope", submittedData: {} },
  });
  assert.equal(unknown.statusCode, 404);
  assert.equal(
    (unknown.json() as { error: string }).error,
    "SHOP_PRODUCT_NOT_FOUND",
  );
  const retiredPremium = await app.inject({
    method: "POST",
    url: "/shop/orders",
    headers: {
      authorization: `Bearer ${first.token}`,
      "idempotency-key": "shop-premium-retired",
    },
    payload: {
      productCode: "premium-6",
      submittedData: { telegramUsername: "ok_user" },
    },
  });
  assert.equal(retiredPremium.statusCode, 404);
  assert.equal(
    (retiredPremium.json() as { error: string }).error,
    "SHOP_PRODUCT_NOT_FOUND",
  );

  const created = await app.inject({
    method: "POST",
    url: "/shop/orders",
    headers: {
      authorization: `Bearer ${first.token}`,
      "idempotency-key": "shop-own",
    },
    payload: {
      productCode: "donat",
      submittedData: { displayNickname: "One", donationText: "hello" },
    },
  });
  assert.equal(created.statusCode, 200);
  const mine = await app.inject({
    method: "GET",
    url: "/profile/orders",
    headers: { authorization: `Bearer ${first.token}` },
  });
  const theirs = await app.inject({
    method: "GET",
    url: "/profile/orders",
    headers: { authorization: `Bearer ${second.token}` },
  });
  assert.equal((mine.json() as { items: unknown[] }).items.length, 1);
  assert.equal((theirs.json() as { items: unknown[] }).items.length, 0);
  await app.close();
});

test("normal Mini App user cannot manage shop orders", async () => {
  const mini = await miniToken(96008);
  const app = createApiApp({ db, authPolicy: policy });
  const listed = await app.inject({
    method: "GET",
    url: "/admin/shop/orders",
    headers: { authorization: `Bearer ${mini.token}` },
  });
  assert.equal(listed.statusCode, 401);
  const processed = await app.inject({
    method: "POST",
    url: "/admin/shop/orders/00000000-0000-4000-8000-000000000001/process",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "mini-process",
    },
  });
  assert.equal(processed.statusCode, 401);
  await app.close();
});

test("super_admin can list, process, fulfill, and reject with exact refund", async () => {
  const admin = await adminToken(96009);
  const user = await miniToken(96010);
  await credit(user.userId, 11111n, `deposit:${user.userId}:admin-flow`);
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: "/shop/orders",
    headers: {
      authorization: `Bearer ${user.token}`,
      "idempotency-key": "shop-admin-flow",
    },
    payload: {
      productCode: "welvura-200",
      submittedData: { welvuraId: "WID-ADMIN" },
    },
  });
  assert.equal(created.statusCode, 200);
  const createdBody = created.json() as { orderId: string };

  const listed = await app.inject({
    method: "GET",
    url: "/admin/shop/orders?status=pending",
    headers: { authorization: `Bearer ${admin.token}` },
  });
  assert.equal(listed.statusCode, 200);
  const listBody = listed.json() as {
    items: Array<{ id: string; priceAzc: string; status: string }>;
  };
  assert.ok(listBody.items.some((row) => row.id === createdBody.orderId));

  const processed = await app.inject({
    method: "POST",
    url: `/admin/shop/orders/${createdBody.orderId}/process`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "shop-admin-process",
    },
  });
  assert.equal(processed.statusCode, 200);
  assert.equal((processed.json() as { status: string }).status, "processing");

  const replayProcess = await app.inject({
    method: "POST",
    url: `/admin/shop/orders/${createdBody.orderId}/process`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "shop-admin-process",
    },
  });
  assert.equal(replayProcess.statusCode, 200);

  const fulfilledUser = await miniToken(96011);
  await credit(fulfilledUser.userId, 4000n, `deposit:${fulfilledUser.userId}:ful`);
  const toFulfill = await app.inject({
    method: "POST",
    url: "/shop/orders",
    headers: {
      authorization: `Bearer ${fulfilledUser.token}`,
      "idempotency-key": "shop-admin-fulfill",
    },
    payload: {
      productCode: "music",
      submittedData: { mediaUrl: "https://soundcloud.com/a/b" },
    },
  });
  const fulfillId = (toFulfill.json() as { orderId: string }).orderId;
  const fulfilled = await app.inject({
    method: "POST",
    url: `/admin/shop/orders/${fulfillId}/fulfill`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "shop-admin-fulfill-ok",
    },
  });
  assert.equal(fulfilled.statusCode, 200);
  assert.equal((fulfilled.json() as { status: string }).status, "fulfilled");

  const rejectAfter = await app.inject({
    method: "POST",
    url: `/admin/shop/orders/${fulfillId}/reject`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "shop-admin-reject-late",
    },
    payload: { reason: "too late" },
  });
  assert.equal(rejectAfter.statusCode, 400);
  assert.equal(
    (rejectAfter.json() as { error: string }).error,
    "INVALID_TRANSITION",
  );

  const missing = await app.inject({
    method: "POST",
    url: `/admin/shop/orders/${createdBody.orderId}/reject`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "shop-reject-empty",
    },
    payload: { reason: "   " },
  });
  assert.equal(missing.statusCode, 400);
  assert.equal((missing.json() as { error: string }).error, "BAD_REQUEST");

  const rejected = await app.inject({
    method: "POST",
    url: `/admin/shop/orders/${createdBody.orderId}/reject`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "shop-reject-ok",
    },
    payload: { reason: "нет слотов" },
  });
  assert.equal(rejected.statusCode, 200);
  assert.equal((rejected.json() as { status: string }).status, "rejected");

  const profile = await app.inject({
    method: "GET",
    url: "/profile",
    headers: { authorization: `Bearer ${user.token}` },
  });
  assert.equal(
    (profile.json() as { balances: { azc: string } }).balances.azc,
    "11111",
  );

  const refunds = await db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  assert.equal(refunds.filter((row) => row.type === "shop_refund").length, 1);
  assert.equal(
    asBigInt(refunds.find((row) => row.type === "shop_refund")?.amountMinor ?? 0n),
    11111n,
  );

  const audits = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.targetId, createdBody.orderId));
  assert.ok(audits.some((row) => row.action === "shop_order.processing"));
  assert.ok(audits.some((row) => row.action === "shop_order.rejected"));
  await app.close();
});

test("bonus and custom-slot orders persist payload and appear in profile/admin", async () => {
  const admin = await adminToken(96021);
  const mini = await miniToken(96022);
  await credit(mini.userId, 90_000n, `deposit:${mini.userId}:bonus-api`);
  const app = createApiApp({ db, authPolicy: policy });
  const bonus = await app.inject({
    method: "POST",
    url: "/shop/orders",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "shop-bonus-3000",
    },
    payload: {
      productCode: "welvura-bonus-3000",
      submittedData: { welvuraId: "123456", slotName: "Sweet Bonanza" },
    },
  });
  assert.equal(bonus.statusCode, 200);
  const bonusBody = bonus.json() as {
    orderId: string;
    priceAzc: string;
    newBalanceAzc: string;
  };
  assert.equal(bonusBody.priceAzc, "77777");
  assert.equal(bonusBody.newBalanceAzc, "12223");

  const slot = await app.inject({
    method: "POST",
    url: "/shop/orders",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "shop-custom-slot",
    },
    payload: {
      productCode: "custom-slot",
      submittedData: { slotName: "Gates of Olympus" },
    },
  });
  assert.equal(slot.statusCode, 200);
  const slotBody = slot.json() as { orderId: string; priceAzc: string };
  assert.equal(slotBody.priceAzc, "5555");

  const replay = await app.inject({
    method: "POST",
    url: "/shop/orders",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "shop-bonus-3000",
    },
    payload: {
      productCode: "welvura-bonus-3000",
      submittedData: { welvuraId: "123456", slotName: "Sweet Bonanza" },
    },
  });
  assert.equal((replay.json() as { replayed: boolean }).replayed, true);

  const mine = await app.inject({
    method: "GET",
    url: "/profile/orders",
    headers: { authorization: `Bearer ${mini.token}` },
  });
  const mineItems = (
    mine.json() as {
      items: Array<{
        id: string;
        productName: string;
        submittedPreview: Record<string, string>;
      }>;
    }
  ).items;
  const bonusMine = mineItems.find((row) => row.id === bonusBody.orderId);
  const slotMine = mineItems.find((row) => row.id === slotBody.orderId);
  assert.equal(bonusMine?.productName, "БОНУСКА ЗА 3000 ₽");
  assert.deepEqual(bonusMine?.submittedPreview, {
    welvuraId: "123456",
    slotName: "Sweet Bonanza",
  });
  assert.equal(slotMine?.productName, "ЗАКАЗАТЬ СВОЙ СЛОТ");
  assert.deepEqual(slotMine?.submittedPreview, {
    slotName: "Gates of Olympus",
  });

  const listed = await app.inject({
    method: "GET",
    url: "/admin/shop/orders?status=pending",
    headers: { authorization: `Bearer ${admin.token}` },
  });
  const adminItems = (
    listed.json() as {
      items: Array<{
        id: string;
        productName: string;
        submittedPayload: Record<string, string>;
      }>;
    }
  ).items;
  const bonusAdmin = adminItems.find((row) => row.id === bonusBody.orderId);
  const slotAdmin = adminItems.find((row) => row.id === slotBody.orderId);
  assert.equal(bonusAdmin?.productName, "БОНУСКА ЗА 3000 ₽");
  assert.deepEqual(bonusAdmin?.submittedPayload, {
    welvuraId: "123456",
    slotName: "Sweet Bonanza",
  });
  assert.equal(slotAdmin?.productName, "ЗАКАЗАТЬ СВОЙ СЛОТ");
  assert.deepEqual(slotAdmin?.submittedPayload, {
    slotName: "Gates of Olympus",
  });
  await app.close();
});
