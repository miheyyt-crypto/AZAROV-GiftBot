import {
  inventoryItems,
  notifications,
  products,
  purchases,
  streamDonations,
  walletTransactions,
} from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  InvalidTransitionError,
  ShopInsufficientBalanceError,
  ShopInvalidDonationNicknameError,
  ShopInvalidDonationTextError,
  ShopInvalidKickUsernameError,
  ShopInvalidMediaUrlError,
  ShopInvalidSlotNameError,
  ShopInvalidWelvuraIdError,
  ShopProductNotFoundError,
  ShopRejectionReasonRequiredError,
} from "./errors.js";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import {
  SHOP_CATALOG,
  createShopOrder,
  ensureShopCatalog,
  fulfillShopOrder,
  getShopProduct,
  listAdminShopOrders,
  listShopCatalog,
  markShopOrderProcessing,
  parseMediaUrl,
  parseShopSlotName,
  presentShopCatalog,
  rejectShopOrder,
  validateShopSubmittedData,
} from "./shop.js";
import { provisionUser } from "./user.js";
import { apply, reconcileWallet } from "./wallet.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
  await ensureShopCatalog(harness.db);
});

after(async () => {
  await harness.stop();
});

async function credit(userId: string, amount: bigint, key: string): Promise<void> {
  await apply(harness.db, {
    userId,
    type: "deposit",
    amountMinor: amount,
    idempotencyKey: key,
    actorType: "system",
  });
}

test("canonical shop catalog has the approved prices", () => {
  const byCode = Object.fromEntries(
    SHOP_CATALOG.map((item) => [item.code, item.priceAzc.toString()]),
  );
  assert.equal(byCode["welvura-200"], "11111");
  assert.equal(byCode["welvura-500"], "22222");
  assert.equal(byCode["welvura-5000"], "199999");
  assert.equal(byCode["donat"], "1000");
  assert.equal(byCode["music"], "4000");
  assert.equal(byCode["streak-freeze"], "1000");
  assert.equal(byCode["vip-kick"], "149999");
  assert.equal(byCode["welvura-bonus-3000"], "77777");
  assert.equal(byCode["custom-slot"], "5555");
  assert.equal(byCode["premium-6"], undefined);
  assert.equal(byCode["premium-12"], undefined);
  assert.equal(SHOP_CATALOG.length, 9);
  assert.deepEqual(getShopProduct("welvura-bonus-3000").requiredFields, [
    "welvuraId",
    "slotName",
  ]);
  assert.deepEqual(getShopProduct("custom-slot").requiredFields, ["slotName"]);
  assert.deepEqual(
    SHOP_CATALOG.map((item) => item.code),
    [
      "welvura-200",
      "welvura-500",
      "welvura-5000",
      "welvura-bonus-3000",
      "donat",
      "music",
      "custom-slot",
      "streak-freeze",
      "vip-kick",
    ],
  );
});

test("presentShopCatalog keeps SHOP_CATALOG order when slugs arrive scrambled", () => {
  const scrambled = [
    "vip-kick",
    "custom-slot",
    "welvura-200",
    "music",
    "streak-freeze",
    "donat",
    "welvura-bonus-3000",
    "welvura-5000",
    "welvura-500",
  ];
  assert.deepEqual(
    presentShopCatalog(scrambled).map((item) => item.code),
    SHOP_CATALOG.map((item) => item.code),
  );
  assert.deepEqual(
    presentShopCatalog(["streak-freeze", "custom-slot", "music"], "other").map(
      (item) => item.code,
    ),
    ["music", "custom-slot", "streak-freeze"],
  );
  assert.deepEqual(
    presentShopCatalog(
      ["donat", "welvura-bonus-3000", "welvura-200", "vip-kick"],
      "money",
    ).map((item) => item.code),
    ["welvura-200", "welvura-bonus-3000"],
  );
});

test("submitted field validation is strict per product", () => {
  const welvura = getShopProduct("welvura-200");
  assert.deepEqual(validateShopSubmittedData(welvura, { welvuraId: "WV-1" }), {
    welvuraId: "WV-1",
  });
  assert.throws(
    () => validateShopSubmittedData(welvura, { welvuraId: "<script>" }),
    ShopInvalidWelvuraIdError,
  );
  assert.throws(() => getShopProduct("premium-6"), ShopProductNotFoundError);
  assert.throws(() => getShopProduct("premium-12"), ShopProductNotFoundError);
  assert.throws(
    () =>
      validateShopSubmittedData(getShopProduct("vip-kick"), {
        kickUsername: "t.me/bad",
      }),
    ShopInvalidKickUsernameError,
  );
  assert.throws(
    () =>
      validateShopSubmittedData(getShopProduct("donat"), {
        displayNickname: "",
        donationText: "hi",
      }),
    ShopInvalidDonationNicknameError,
  );
  assert.throws(
    () =>
      validateShopSubmittedData(getShopProduct("donat"), {
        displayNickname: "ok",
        donationText: "x".repeat(301),
      }),
    ShopInvalidDonationTextError,
  );
  const threeHundred = "я".repeat(300);
  assert.equal(threeHundred.length, 300);
  assert.equal(
    validateShopSubmittedData(getShopProduct("donat"), {
      displayNickname: "ok",
      donationText: threeHundred,
    }).donationText,
    threeHundred,
  );
  const emoji = "👍";
  assert.equal(emoji.length, 2);
  assert.doesNotThrow(() =>
    validateShopSubmittedData(getShopProduct("donat"), {
      displayNickname: "ok",
      donationText: `${"a".repeat(298)}${emoji}`,
    }),
  );
  assert.throws(
    () =>
      validateShopSubmittedData(getShopProduct("donat"), {
        displayNickname: "ok",
        donationText: `${"a".repeat(299)}${emoji}`,
      }),
    ShopInvalidDonationTextError,
  );
  assert.equal(
    parseMediaUrl("https://www.youtube.com/watch?v=dQw4w9wgGcQ"),
    "https://www.youtube.com/watch?v=dQw4w9wgGcQ",
  );
  assert.doesNotThrow(() => parseMediaUrl("https://soundcloud.com/artist/track"));
  assert.throws(() => parseMediaUrl("https://example.com/song"), ShopInvalidMediaUrlError);
  const bonus = getShopProduct("welvura-bonus-3000");
  assert.deepEqual(
    validateShopSubmittedData(bonus, {
      welvuraId: " 123456 ",
      slotName: "  Sweet Bonanza  ",
    }),
    { welvuraId: "123456", slotName: "Sweet Bonanza" },
  );
  assert.throws(
    () => validateShopSubmittedData(bonus, { slotName: "Sweet Bonanza" }),
    ShopInvalidWelvuraIdError,
  );
  assert.throws(
    () =>
      validateShopSubmittedData(bonus, {
        welvuraId: "123456",
        slotName: "   ",
      }),
    ShopInvalidSlotNameError,
  );
  assert.throws(
    () =>
      validateShopSubmittedData(getShopProduct("custom-slot"), { slotName: "" }),
    ShopInvalidSlotNameError,
  );
  assert.equal(parseShopSlotName("Gates of Olympus"), "Gates of Olympus");
  assert.throws(() => parseShopSlotName("x".repeat(81)), ShopInvalidSlotNameError);
  assert.throws(() => getShopProduct("nope"), ShopProductNotFoundError);
});

test("manual purchase debits through Wallet.apply and stays pending", async () => {
  const user = await provisionUser(harness.db);
  await credit(user.userId, 20_000n, `deposit:${user.userId}:shop-manual`);
  const created = await createShopOrder(harness.db, {
    userId: user.userId,
    productCode: "welvura-200",
    submittedData: { welvuraId: "WID123" },
    idempotencyKey: `shop:${user.userId}:welvura`,
  });
  assert.equal(created.status, "pending");
  assert.equal(created.priceAzc, "11111");
  assert.equal(created.newBalanceAzc, "8889");
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.consistent, true);
  assert.equal(report.balanceMinor, 8889n);
  const ledger = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  assert.ok(ledger.some((row) => row.type === "shop_purchase"));
  const notes = await harness.db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.userId));
  assert.ok(notes.some((row) => row.title === "Заказ создан"));
});

test("donat purchase is fulfilled and enqueues one stream alert", async () => {
  const user = await provisionUser(harness.db);
  await credit(user.userId, 1500n, `deposit:${user.userId}:donat-auto`);
  const created = await createShopOrder(harness.db, {
    userId: user.userId,
    productCode: "donat",
    submittedData: { displayNickname: "FormNick", donationText: "on stream" },
    idempotencyKey: `shop:${user.userId}:donat-auto`,
  });
  assert.equal(created.status, "fulfilled");
  const notes = await harness.db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.userId));
  assert.ok(notes.some((row) => row.title === "Донат отправлен на стрим"));
  const alerts = await harness.db
    .select()
    .from(streamDonations)
    .where(eq(streamDonations.shopPurchaseId, created.orderId));
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.message, "on stream");
  assert.equal(alerts[0]?.displayName, "FormNick");
});

test("insufficient balance becomes SHOP_INSUFFICIENT_BALANCE", async () => {
  const user = await provisionUser(harness.db);
  await credit(user.userId, 10n, `deposit:${user.userId}:shop-low`);
  await assert.rejects(
    () =>
      createShopOrder(harness.db, {
        userId: user.userId,
        productCode: "donat",
        submittedData: { displayNickname: "Nick", donationText: "hello" },
        idempotencyKey: `shop:${user.userId}:low`,
      }),
    ShopInsufficientBalanceError,
  );
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 10n);
  const alerts = await harness.db
    .select()
    .from(streamDonations)
    .where(eq(streamDonations.userId, user.userId));
  assert.equal(alerts.length, 0);
});

test("streak freeze purchase grants inventory atomically", async () => {
  const user = await provisionUser(harness.db);
  await credit(user.userId, 2000n, `deposit:${user.userId}:freeze`);
  const created = await createShopOrder(harness.db, {
    userId: user.userId,
    productCode: "streak-freeze",
    submittedData: {},
    idempotencyKey: `shop:${user.userId}:freeze`,
  });
  assert.equal(created.status, "fulfilled");
  assert.deepEqual(created.inventoryGranted, {
    type: "streak_freeze",
    quantity: 1,
  });
  const items = await harness.db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.userId, user.userId));
  assert.equal(items.length, 1);
  assert.equal(items[0]?.itemType, "streak_freeze");
  assert.equal(items[0]?.quantity, 1);
});

test("same idempotency key replays freeze without a second inventory grant", async () => {
  const user = await provisionUser(harness.db);
  await credit(user.userId, 5000n, `deposit:${user.userId}:freeze-replay`);
  const first = await createShopOrder(harness.db, {
    userId: user.userId,
    productCode: "streak-freeze",
    submittedData: {},
    idempotencyKey: `shop:${user.userId}:freeze-same`,
  });
  const second = await createShopOrder(harness.db, {
    userId: user.userId,
    productCode: "streak-freeze",
    submittedData: {},
    idempotencyKey: `shop:${user.userId}:freeze-same`,
  });
  assert.equal(second.replayed, true);
  assert.equal(second.orderId, first.orderId);
  const items = await harness.db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.userId, user.userId));
  const qty = items.reduce((sum, row) => sum + row.quantity, 0);
  assert.equal(qty, 1);
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 4000n);
});

test("reject refunds the snapshot price and cannot refund twice", async () => {
  const admin = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await credit(user.userId, 11111n, `deposit:${user.userId}:refund`);
  const created = await createShopOrder(harness.db, {
    userId: user.userId,
    productCode: "welvura-200",
    submittedData: { welvuraId: "WID" },
    idempotencyKey: `shop:${user.userId}:refund`,
  });
  await rejectShopOrder(harness.db, {
    orderId: created.orderId,
    adminUserId: admin.userId,
    reason: "нет слотов",
    idempotencyKey: `shop.reject:${created.orderId}:a`,
  });
  const after = await reconcileWallet(harness.db, user.userId);
  assert.equal(after.balanceMinor, 11111n);
  const again = await rejectShopOrder(harness.db, {
    orderId: created.orderId,
    adminUserId: admin.userId,
    reason: "нет слотов",
    idempotencyKey: `shop.reject:${created.orderId}:b`,
  });
  assert.equal(again.replayed, true);
  const still = await reconcileWallet(harness.db, user.userId);
  assert.equal(still.balanceMinor, 11111n);
  const refunds = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  assert.equal(refunds.filter((row) => row.type === "shop_refund").length, 1);
});

test("fulfilled orders cannot be refunded", async () => {
  const admin = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await credit(user.userId, 4000n, `deposit:${user.userId}:ful`);
  const created = await createShopOrder(harness.db, {
    userId: user.userId,
    productCode: "music",
    submittedData: { mediaUrl: "https://soundcloud.com/a/b" },
    idempotencyKey: `shop:${user.userId}:ful`,
  });
  await fulfillShopOrder(harness.db, {
    orderId: created.orderId,
    adminUserId: admin.userId,
    idempotencyKey: `shop.fulfill:${created.orderId}`,
  });
  await assert.rejects(
    () =>
      rejectShopOrder(harness.db, {
        orderId: created.orderId,
        adminUserId: admin.userId,
        reason: "too late",
        idempotencyKey: `shop.reject:${created.orderId}:late`,
      }),
    InvalidTransitionError,
  );
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 0n);
});

test("reject requires a reason", async () => {
  const admin = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await credit(user.userId, 4000n, `deposit:${user.userId}:reason`);
  const created = await createShopOrder(harness.db, {
    userId: user.userId,
    productCode: "music",
    submittedData: { mediaUrl: "https://soundcloud.com/a/b" },
    idempotencyKey: `shop:${user.userId}:reason`,
  });
  await assert.rejects(
    () =>
      rejectShopOrder(harness.db, {
        orderId: created.orderId,
        adminUserId: admin.userId,
        reason: "  ",
        idempotencyKey: `shop.reject:${created.orderId}:empty`,
      }),
    ShopRejectionReasonRequiredError,
  );
});

test("state machine allows pending to processing then fulfilled", async () => {
  const admin = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await credit(user.userId, 149999n, `deposit:${user.userId}:proc`);
  const created = await createShopOrder(harness.db, {
    userId: user.userId,
    productCode: "vip-kick",
    submittedData: { kickUsername: "premium_user" },
    idempotencyKey: `shop:${user.userId}:proc`,
  });
  const processed = await markShopOrderProcessing(harness.db, {
    orderId: created.orderId,
    adminUserId: admin.userId,
    idempotencyKey: `shop.process:${created.orderId}`,
  });
  assert.equal(processed.order.status, "processing");
  const fulfilled = await fulfillShopOrder(harness.db, {
    orderId: created.orderId,
    adminUserId: admin.userId,
    idempotencyKey: `shop.fulfill:${created.orderId}`,
  });
  assert.equal(fulfilled.order.status, "fulfilled");
});

test("concurrent same-key purchases debit once", async () => {
  const user = await provisionUser(harness.db);
  await credit(user.userId, 20_000n, `deposit:${user.userId}:conc-key`);
  const results = await Promise.allSettled([
    createShopOrder(harness.db, {
      userId: user.userId,
      productCode: "welvura-200",
      submittedData: { welvuraId: "A1" },
      idempotencyKey: `shop:${user.userId}:same-key`,
    }),
    createShopOrder(harness.db, {
      userId: user.userId,
      productCode: "welvura-200",
      submittedData: { welvuraId: "A1" },
      idempotencyKey: `shop:${user.userId}:same-key`,
    }),
  ]);
  const ok = results.filter((row) => row.status === "fulfilled");
  assert.equal(ok.length, 2);
  const ids = new Set(
    ok.map((row) => (row.status === "fulfilled" ? row.value.orderId : "")),
  );
  assert.equal(ids.size, 1);
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 8889n);
  const orders = await harness.db
    .select()
    .from(purchases)
    .where(eq(purchases.userId, user.userId));
  assert.equal(orders.length, 1);
});

test("fulfill vs reject race has one terminal outcome", async () => {
  const adminA = await provisionUser(harness.db);
  const adminB = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await credit(user.userId, 4000n, `deposit:${user.userId}:race`);
  const created = await createShopOrder(harness.db, {
    userId: user.userId,
    productCode: "music",
    submittedData: { mediaUrl: "https://soundcloud.com/a/b" },
    idempotencyKey: `shop:${user.userId}:race`,
  });
  const results = await Promise.allSettled([
    fulfillShopOrder(harness.db, {
      orderId: created.orderId,
      adminUserId: adminA.userId,
      idempotencyKey: `shop.fulfill:${created.orderId}:race`,
    }),
    rejectShopOrder(harness.db, {
      orderId: created.orderId,
      adminUserId: adminB.userId,
      reason: "race",
      idempotencyKey: `shop.reject:${created.orderId}:race`,
    }),
  ]);
  const ok = results.filter((row) => row.status === "fulfilled");
  const failed = results.filter((row) => row.status === "rejected");
  assert.equal(ok.length, 1);
  assert.equal(failed.length, 1);
  const report = await reconcileWallet(harness.db, user.userId);
  const winner = ok[0];
  assert.ok(winner && winner.status === "fulfilled");
  if (winner.value.order.status === "fulfilled") {
    assert.equal(report.balanceMinor, 0n);
  } else {
    assert.equal(report.balanceMinor, 1000n);
  }
});

test("concurrent reject attempts refund once", async () => {
  const adminA = await provisionUser(harness.db);
  const adminB = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await credit(user.userId, 4000n, `deposit:${user.userId}:conc-rej`);
  const created = await createShopOrder(harness.db, {
    userId: user.userId,
    productCode: "music",
    submittedData: { mediaUrl: "https://youtu.be/aaaaaaaaaaa" },
    idempotencyKey: `shop:${user.userId}:conc-rej`,
  });
  const results = await Promise.allSettled([
    rejectShopOrder(harness.db, {
      orderId: created.orderId,
      adminUserId: adminA.userId,
      reason: "one",
      idempotencyKey: `shop.reject:${created.orderId}:c1`,
    }),
    rejectShopOrder(harness.db, {
      orderId: created.orderId,
      adminUserId: adminB.userId,
      reason: "two",
      idempotencyKey: `shop.reject:${created.orderId}:c2`,
    }),
  ]);
  const ok = results.filter((row) => row.status === "fulfilled");
  assert.equal(ok.length, 2);
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 4000n);
  const refunds = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  assert.equal(refunds.filter((row) => row.type === "shop_refund").length, 1);
});

test("listShopCatalog only returns active canonical products", async () => {
  const listed = await listShopCatalog(harness.db);
  assert.equal(listed.length, 9);
  const byCode = Object.fromEntries(listed.map((item) => [item.code, item.priceAzc]));
  assert.equal(byCode["welvura-bonus-3000"], "77777");
  assert.equal(byCode["custom-slot"], "5555");
  assert.ok(!listed.some((item) => item.code.startsWith("premium-")));
  assert.ok(listed.every((item) => item.priceAzc === getShopProduct(item.code).priceAzc.toString()));
  const catalogCodes = SHOP_CATALOG.map((item) => item.code);
  assert.deepEqual(
    listed.map((item) => item.code),
    catalogCodes,
  );
  const alphabetical = await harness.db
    .select({ slug: products.slug })
    .from(products)
    .where(eq(products.status, "active"))
    .orderBy(products.slug);
  const alphaCatalog = alphabetical
    .map((row) => row.slug)
    .filter((slug) => catalogCodes.includes(slug));
  assert.notDeepEqual(alphaCatalog, catalogCodes);
  assert.deepEqual(
    presentShopCatalog(alphaCatalog).map((item) => item.code),
    catalogCodes,
  );
});

test("bonus and custom-slot purchases debit Wallet.apply and store payload", async () => {
  const admin = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await credit(user.userId, 90_000n, `deposit:${user.userId}:bonus-slot`);
  const bonus = await createShopOrder(harness.db, {
    userId: user.userId,
    productCode: "welvura-bonus-3000",
    submittedData: { welvuraId: "123456", slotName: "Sweet Bonanza" },
    idempotencyKey: `shop:${user.userId}:bonus`,
  });
  assert.equal(bonus.status, "pending");
  assert.equal(bonus.priceAzc, "77777");
  assert.equal(bonus.newBalanceAzc, "12223");
  const replay = await createShopOrder(harness.db, {
    userId: user.userId,
    productCode: "welvura-bonus-3000",
    submittedData: { welvuraId: "123456", slotName: "Sweet Bonanza" },
    idempotencyKey: `shop:${user.userId}:bonus`,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.orderId, bonus.orderId);
  let report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 12223n);

  const slot = await createShopOrder(harness.db, {
    userId: user.userId,
    productCode: "custom-slot",
    submittedData: { slotName: "Gates of Olympus" },
    idempotencyKey: `shop:${user.userId}:custom-slot`,
  });
  assert.equal(slot.status, "pending");
  assert.equal(slot.priceAzc, "5555");
  assert.equal(slot.newBalanceAzc, "6668");
  report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 6668n);

  await assert.rejects(
    () =>
      createShopOrder(harness.db, {
        userId: user.userId,
        productCode: "welvura-bonus-3000",
        submittedData: { welvuraId: "123456", slotName: "Too Poor" },
        idempotencyKey: `shop:${user.userId}:bonus-poor`,
      }),
    ShopInsufficientBalanceError,
  );
  report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 6668n);

  const bonusListed = await listAdminShopOrders(harness.db, {
    status: "pending",
    productCode: "welvura-bonus-3000",
  });
  const slotListed = await listAdminShopOrders(harness.db, {
    status: "pending",
    productCode: "custom-slot",
  });
  const bonusRow = bonusListed.items.find((row) => row.id === bonus.orderId);
  const slotRow = slotListed.items.find((row) => row.id === slot.orderId);
  assert.equal(bonusRow?.productName, "БОНУСКА ЗА 3000 ₽");
  assert.deepEqual(bonusRow?.submittedPayload, {
    welvuraId: "123456",
    slotName: "Sweet Bonanza",
  });
  assert.equal(slotRow?.productName, "ЗАКАЗАТЬ СВОЙ СЛОТ");
  assert.deepEqual(slotRow?.submittedPayload, { slotName: "Gates of Olympus" });

  await rejectShopOrder(harness.db, {
    orderId: bonus.orderId,
    adminUserId: admin.userId,
    reason: "нет бонуски",
    idempotencyKey: `shop.reject:${bonus.orderId}:a`,
  });
  report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 84445n);
});
