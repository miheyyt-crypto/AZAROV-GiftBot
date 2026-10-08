import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrdersPage } from "../pages/OrdersPage.js";
import {
  AdminShopOrdersView,
  OrdersView,
  ShopView,
} from "./ShopView.js";
import {
  clientShopValidationError,
  friendlyAdminShopActionError,
  friendlyShopError,
  friendlyShopStatus,
  type ShopCatalogProduct,
} from "./shop-messages.js";

const SAMPLE_CATALOG: ShopCatalogProduct[] = [
  {
    code: "welvura-200",
    title: "200 ₽ Welvura",
    category: "money",
    priceAzc: "11111",
    fulfillmentType: "manual",
    requiredFields: ["welvuraId"],
    description: "Пополнение Welvura на 200 ₽.",
  },
  {
    code: "welvura-500",
    title: "500 ₽ Welvura",
    category: "money",
    priceAzc: "22222",
    fulfillmentType: "manual",
    requiredFields: ["welvuraId"],
    description: "Пополнение Welvura на 500 ₽.",
  },
  {
    code: "welvura-5000",
    title: "5 000 ₽ Welvura",
    category: "money",
    priceAzc: "199999",
    fulfillmentType: "manual",
    requiredFields: ["welvuraId"],
    description: "Пополнение Welvura на 5 000 ₽.",
  },
  {
    code: "welvura-bonus-3000",
    title: "БОНУСКА ЗА 3000 ₽",
    category: "money",
    priceAzc: "77777",
    fulfillmentType: "manual",
    requiredFields: ["welvuraId", "slotName"],
    description: "Укажите свой Welvura ID и название слота для заказа бонуски.",
  },
  {
    code: "donat",
    title: "Донат на стрим",
    category: "donations",
    priceAzc: "1000",
    fulfillmentType: "manual",
    requiredFields: ["displayNickname", "donationText"],
    description: "Сообщение появится на стриме автоматически.",
  },
  {
    code: "music",
    title: "Заказать музыку",
    category: "other",
    priceAzc: "4000",
    fulfillmentType: "manual",
    requiredFields: ["mediaUrl"],
    description: "Только YouTube или SoundCloud.",
  },
  {
    code: "custom-slot",
    title: "ЗАКАЗАТЬ СВОЙ СЛОТ",
    category: "other",
    priceAzc: "5555",
    fulfillmentType: "manual",
    requiredFields: ["slotName"],
    description: "Укажите название слота, который хотите заказать.",
  },
  {
    code: "streak-freeze",
    title: "Streak Freeze",
    category: "other",
    priceAzc: "1000",
    fulfillmentType: "instant",
    requiredFields: [],
    description: "Добавляет 1 Streak Freeze.",
  },
  {
    code: "vip-kick",
    title: "VIP Kick навсегда",
    category: "subs",
    priceAzc: "149999",
    fulfillmentType: "manual",
    requiredFields: ["kickUsername"],
    description: "VIP на Kick.",
  },
];

test("shop view renders canonical catalog prices", () => {
  const html = renderToStaticMarkup(
    createElement(ShopView, {
      catalog: SAMPLE_CATALOG,
      balanceAzc: "12840",
      mainTab: "store",
      filter: "all",
      fields: {},
      onMainTabChange: () => undefined,
      onFilterChange: () => undefined,
      onSelect: () => undefined,
      onClose: () => undefined,
      onFieldChange: () => undefined,
      onBuy: () => undefined,
      onOrders: () => undefined,
    }),
  );
  assert.match(html, /200 ₽ Welvura/);
  assert.match(html, /11 111/);
  assert.match(html, /5 555/);
  assert.match(html, /1 000/);
  assert.match(html, /Streak Freeze/);
  assert.match(html, /12 840/);
  assert.match(html, /ROLLS/);
  assert.match(html, /MINES/);
  assert.match(html, /DICE/);
  assert.doesNotMatch(html, /TOWER|Tower/);
  assert.doesNotMatch(html, /AZC/);
  assert.match(html, /\/assets\/coin-icon\.png/);
  assert.match(html, /VIP Kick навсегда/);
  assert.match(html, /Заказать музыку/);
  assert.match(html, /БОНУСКА ЗА 3000 ₽/);
  assert.match(html, /ЗАКАЗАТЬ СВОЙ СЛОТ/);
  assert.match(html, /77 777/);
  assert.match(html, /shop-art--welvura-bonus/);
  assert.match(html, /shop-art--custom-slot/);
  assert.match(html, /\/assets\/shop-vip\.png/);
  assert.match(html, /\/assets\/shop-donation\.png/);
  assert.match(html, /\/assets\/shop-music\.png/);
  assert.match(html, /\/assets\/shop-freeze\.png/);
  assert.match(html, /\/assets\/shop-welvura-200\.png/);
  assert.match(html, /\/assets\/shop-welvura-bonus-3000\.png/);
  assert.match(html, /\/assets\/shop-custom-slot\.png/);
  assert.doesNotMatch(html, /Telegram Premium/);
  assert.deepEqual(
    [...html.matchAll(/class="shop-product-card__title">([^<]+)</g)].map(
      (row) => row[1],
    ),
    [
      "200 ₽ Welvura",
      "500 ₽ Welvura",
      "5 000 ₽ Welvura",
      "БОНУСКА ЗА 3000 ₽",
      "Донат на стрим",
      "Заказать музыку",
      "ЗАКАЗАТЬ СВОЙ СЛОТ",
      "Streak Freeze",
      "VIP Kick навсегда",
    ],
  );
  assert.match(html, /shop-product-card__cta--pink/);
  assert.match(
    html,
    /shop-art--custom-slot[\s\S]*shop-product-card__cta--pink/,
  );
  assert.doesNotMatch(
    html,
    /shop-art--custom-slot[\s\S]*shop-product-card__cta--slot/,
  );
  const otherHtml = renderToStaticMarkup(
    createElement(ShopView, {
      catalog: SAMPLE_CATALOG,
      balanceAzc: "12840",
      mainTab: "store",
      filter: "other",
      fields: {},
      onMainTabChange: () => undefined,
      onFilterChange: () => undefined,
      onSelect: () => undefined,
      onClose: () => undefined,
      onFieldChange: () => undefined,
      onBuy: () => undefined,
      onOrders: () => undefined,
    }),
  );
  assert.deepEqual(
    [...otherHtml.matchAll(/class="shop-product-card__title">([^<]+)</g)].map(
      (row) => row[1],
    ),
    ["Заказать музыку", "ЗАКАЗАТЬ СВОЙ СЛОТ", "Streak Freeze"],
  );
  for (const name of [
    "shop-vip.png",
    "shop-donation.png",
    "shop-music.png",
    "shop-freeze.png",
    "shop-welvura-200.png",
    "shop-welvura-500.png",
    "shop-welvura-5000.png",
    "shop-welvura-bonus-3000.png",
    "shop-custom-slot.png",
  ]) {
    const png = readFileSync(join(process.cwd(), "src/assets/shop", name));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png[25], 6);
  }
});

test("shop view hides retired Telegram Premium products", () => {
  const html = renderToStaticMarkup(
    createElement(ShopView, {
      catalog: [
        ...SAMPLE_CATALOG,
        {
          code: "premium-6",
          title: "Telegram Premium 6 месяцев",
          category: "subs",
          priceAzc: "34999",
          fulfillmentType: "manual",
          requiredFields: ["telegramUsername"],
          description: "Admin вручную доставляет Telegram Premium.",
        },
        {
          code: "premium-12",
          title: "Telegram Premium 12 месяцев",
          category: "subs",
          priceAzc: "59999",
          fulfillmentType: "manual",
          requiredFields: ["telegramUsername"],
          description: "Admin вручную доставляет Telegram Premium.",
        },
      ],
      balanceAzc: "12840",
      mainTab: "store",
      filter: "all",
      fields: {},
      onMainTabChange: () => undefined,
      onFilterChange: () => undefined,
      onSelect: () => undefined,
      onClose: () => undefined,
      onFieldChange: () => undefined,
      onBuy: () => undefined,
      onOrders: () => undefined,
    }),
  );
  assert.doesNotMatch(html, /Telegram Premium/);
  assert.doesNotMatch(html, /34 999/);
  assert.doesNotMatch(html, /59 999/);
  assert.match(html, /VIP Kick навсегда/);
});

test("purchase sheet shows dynamic fields loading success and errors", () => {
  const welvura = SAMPLE_CATALOG[0]!;
  const form = renderToStaticMarkup(
    createElement(ShopView, {
      catalog: SAMPLE_CATALOG,
      balanceAzc: "12840",
      mainTab: "store",
      filter: "all",
      selected: welvura,
      fields: { welvuraId: "wv-1" },
      onMainTabChange: () => undefined,
      onFilterChange: () => undefined,
      onSelect: () => undefined,
      onClose: () => undefined,
      onFieldChange: () => undefined,
      onBuy: () => undefined,
      onOrders: () => undefined,
    }),
  );
  assert.match(form, /Welvura ID/);
  assert.match(form, /Купить/);
  assert.match(form, /11 111/);
  assert.doesNotMatch(form, /AZC/);

  const loading = renderToStaticMarkup(
    createElement(ShopView, {
      catalog: SAMPLE_CATALOG,
      balanceAzc: "12840",
      mainTab: "store",
      filter: "all",
      selected: welvura,
      fields: { welvuraId: "wv-1" },
      submitting: true,
      onMainTabChange: () => undefined,
      onFilterChange: () => undefined,
      onSelect: () => undefined,
      onClose: () => undefined,
      onFieldChange: () => undefined,
      onBuy: () => undefined,
      onOrders: () => undefined,
    }),
  );
  assert.match(loading, /Покупка…/);
  assert.match(loading, /disabled/);

  const success = renderToStaticMarkup(
    createElement(ShopView, {
      catalog: SAMPLE_CATALOG,
      balanceAzc: "7285",
      mainTab: "store",
      filter: "all",
      selected: welvura,
      fields: {},
      success: true,
      onMainTabChange: () => undefined,
      onFilterChange: () => undefined,
      onSelect: () => undefined,
      onClose: () => undefined,
      onFieldChange: () => undefined,
      onBuy: () => undefined,
      onOrders: () => undefined,
    }),
  );
  assert.match(success, /Заказ создан/);
  assert.match(success, /Ваш заказ успешно оформлен/);
  assert.match(success, /Он уже передан в обработку/);
  assert.match(success, /data-testid="shop-order-success"/);
  assert.match(success, /200 ₽ Welvura/);
  assert.match(success, /Понятно/);
  assert.match(success, /Мои заказы/);
  assert.doesNotMatch(success, /class="ok"/);

  const freeze = SAMPLE_CATALOG.find((item) => item.code === "streak-freeze")!;
  const freezeOk = renderToStaticMarkup(
    createElement(ShopView, {
      catalog: SAMPLE_CATALOG,
      balanceAzc: "11840",
      mainTab: "store",
      filter: "all",
      selected: freeze,
      fields: {},
      success: true,
      onMainTabChange: () => undefined,
      onFilterChange: () => undefined,
      onSelect: () => undefined,
      onClose: () => undefined,
      onFieldChange: () => undefined,
      onBuy: () => undefined,
      onOrders: () => undefined,
    }),
  );
  assert.match(freezeOk, /Заказ создан/);
  assert.match(freezeOk, /Streak Freeze добавлен в инвентарь/);
  assert.match(freezeOk, /data-testid="shop-order-success"/);

  const donat = SAMPLE_CATALOG.find((item) => item.code === "donat")!;
  const donatOk = renderToStaticMarkup(
    createElement(ShopView, {
      catalog: SAMPLE_CATALOG,
      balanceAzc: "7285",
      mainTab: "store",
      filter: "all",
      selected: donat,
      fields: {},
      success: true,
      onMainTabChange: () => undefined,
      onFilterChange: () => undefined,
      onSelect: () => undefined,
      onClose: () => undefined,
      onFieldChange: () => undefined,
      onBuy: () => undefined,
      onOrders: () => undefined,
    }),
  );
  assert.match(donatOk, /Сообщение появится на стриме автоматически/);
  assert.doesNotMatch(donatOk, /Он уже передан в обработку/);

  for (const item of SAMPLE_CATALOG) {
    const html = renderToStaticMarkup(
      createElement(ShopView, {
        catalog: SAMPLE_CATALOG,
        balanceAzc: "200000",
        mainTab: "store",
        filter: "all",
        selected: item,
        fields: {},
        success: true,
        onMainTabChange: () => undefined,
        onFilterChange: () => undefined,
        onSelect: () => undefined,
        onClose: () => undefined,
        onFieldChange: () => undefined,
        onBuy: () => undefined,
        onOrders: () => undefined,
      }),
    );
    assert.match(html, /Заказ создан/);
    assert.match(html, /Ваш заказ успешно оформлен/);
    assert.ok(html.includes(item.title));
    assert.doesNotMatch(html, /class="ok"/);
  }

  const err = renderToStaticMarkup(
    createElement(ShopView, {
      catalog: SAMPLE_CATALOG,
      balanceAzc: "100",
      mainTab: "store",
      filter: "all",
      selected: welvura,
      fields: {},
      note: "Недостаточно монет",
      onMainTabChange: () => undefined,
      onFilterChange: () => undefined,
      onSelect: () => undefined,
      onClose: () => undefined,
      onFieldChange: () => undefined,
      onBuy: () => undefined,
      onOrders: () => undefined,
    }),
  );
  assert.match(err, /Недостаточно монет/);
  assert.match(err, /Не хватает монет/);
});

test("bonus and custom-slot sheets show required fields and local art", () => {
  const bonus = SAMPLE_CATALOG.find((item) => item.code === "welvura-bonus-3000")!;
  const slot = SAMPLE_CATALOG.find((item) => item.code === "custom-slot")!;
  const bonusHtml = renderToStaticMarkup(
    createElement(ShopView, {
      catalog: SAMPLE_CATALOG,
      balanceAzc: "77777",
      mainTab: "store",
      filter: "all",
      selected: bonus,
      fields: {},
      onMainTabChange: () => undefined,
      onFilterChange: () => undefined,
      onSelect: () => undefined,
      onClose: () => undefined,
      onFieldChange: () => undefined,
      onBuy: () => undefined,
      onOrders: () => undefined,
    }),
  );
  assert.match(bonusHtml, /БОНУСКА ЗА 3000 ₽/);
  assert.match(bonusHtml, /77 777/);
  assert.match(bonusHtml, /Укажите свой Welvura ID и название слота для заказа бонуски/);
  assert.match(bonusHtml, /Введите Welvura ID/);
  assert.match(bonusHtml, /Название слота/);
  assert.match(bonusHtml, /Например: Sweet Bonanza/);
  assert.match(bonusHtml, /Купить/);
  assert.doesNotMatch(bonusHtml, /AZC|payload|JSON/);
  assert.match(bonusHtml, /shop-art--welvura-bonus/);
  assert.match(bonusHtml, /\/assets\/shop-welvura-bonus-3000\.png/);

  const slotHtml = renderToStaticMarkup(
    createElement(ShopView, {
      catalog: SAMPLE_CATALOG,
      balanceAzc: "5555",
      mainTab: "store",
      filter: "all",
      selected: slot,
      fields: {},
      onMainTabChange: () => undefined,
      onFilterChange: () => undefined,
      onSelect: () => undefined,
      onClose: () => undefined,
      onFieldChange: () => undefined,
      onBuy: () => undefined,
      onOrders: () => undefined,
    }),
  );
  assert.match(slotHtml, /ЗАКАЗАТЬ СВОЙ СЛОТ/);
  assert.match(slotHtml, /5 555/);
  assert.match(slotHtml, /Укажите название слота, который хотите заказать/);
  assert.match(slotHtml, /Например: Gates of Olympus/);
  assert.match(slotHtml, /shop-art--custom-slot/);
  assert.match(slotHtml, /\/assets\/shop-custom-slot\.png/);
  assert.match(slotHtml, /shop-product-sheet__cta--pink/);
  assert.doesNotMatch(slotHtml, /shop-product-sheet__cta--slot/);
  assert.doesNotMatch(slotHtml, /AZC/);
  const slotLow = renderToStaticMarkup(
    createElement(ShopView, {
      catalog: SAMPLE_CATALOG,
      balanceAzc: "100",
      mainTab: "store",
      filter: "all",
      selected: slot,
      fields: {},
      onMainTabChange: () => undefined,
      onFilterChange: () => undefined,
      onSelect: () => undefined,
      onClose: () => undefined,
      onFieldChange: () => undefined,
      onBuy: () => undefined,
      onOrders: () => undefined,
    }),
  );
  assert.match(slotLow, /Не хватает монет/);
});

test("client shop validation and friendly errors", () => {
  assert.equal(
    clientShopValidationError(SAMPLE_CATALOG[0]!, {}),
    "Некорректный Welvura ID",
  );
  assert.equal(
    clientShopValidationError(
      SAMPLE_CATALOG.find((item) => item.code === "donat")!,
      {
      displayNickname: "nick",
      donationText: "",
    },
    ),
    "Введите текст доната",
  );
  assert.equal(
    clientShopValidationError(
      SAMPLE_CATALOG.find((item) => item.code === "donat")!,
      {
      displayNickname: "x".repeat(21),
      donationText: "hi",
    },
    ),
    "Введите ник для доната",
  );
  assert.equal(
    friendlyShopError("SHOP_INSUFFICIENT_BALANCE"),
    "Недостаточно монет",
  );
  assert.equal(
    friendlyShopError("SHOP_INVALID_MEDIA_URL"),
    "Разрешены только YouTube или SoundCloud",
  );
  assert.equal(
    clientShopValidationError(
      SAMPLE_CATALOG.find((item) => item.code === "welvura-bonus-3000")!,
      { slotName: "Sweet Bonanza" },
    ),
    "Некорректный Welvura ID",
  );
  assert.equal(
    clientShopValidationError(
      SAMPLE_CATALOG.find((item) => item.code === "welvura-bonus-3000")!,
      { welvuraId: "123456", slotName: "  " },
    ),
    "Введите название слота",
  );
  assert.equal(
    clientShopValidationError(
      SAMPLE_CATALOG.find((item) => item.code === "custom-slot")!,
      {},
    ),
    "Введите название слота",
  );
  assert.equal(friendlyShopError("SHOP_INVALID_SLOT_NAME"), "Введите название слота");
  assert.equal(friendlyShopError("STREAM_MEDIA_TOO_LARGE"), "Файл больше 10 МБ");
  assert.equal(
    friendlyShopError("STREAM_MEDIA_NOT_READY"),
    "Файл ещё готовится для показа. Подождите несколько секунд",
  );
  assert.equal(
    friendlyShopError("STREAM_MEDIA_UNSUPPORTED_FORMAT"),
    "Формат не поддерживается. Нужны JPG, PNG, WebP, GIF, MP4, MOV или WebM",
  );
  assert.equal(
    friendlyShopError("STREAM_MEDIA_LIMIT", "Разрешение больше 1920×1920"),
    "Разрешение больше 1920×1920",
  );
  assert.equal(
    friendlyShopError("STREAM_MEDIA_LIMIT", "request failed: 400"),
    "Файл слишком тяжёлый или слишком большого разрешения",
  );
  assert.doesNotMatch(friendlyShopError("SQLSTATE_23505"), /SQL|23505/);
  assert.equal(
    friendlyAdminShopActionError({
      status: 401,
      code: "UNAUTHORIZED",
      message: "session is missing, expired, or revoked",
    }),
    "Сессия администратора истекла. Обновите страницу.",
  );
  assert.equal(
    friendlyAdminShopActionError({
      status: 400,
      code: "STREAM_MEDIA_NOT_READY",
      message: "media is not ready",
    }),
    "Файл ещё готовится для показа. Подождите несколько секунд",
  );
});

test("orders view shows friendly statuses and rejection reason", () => {
  const html = renderToStaticMarkup(
    createElement(OrdersView, {
      items: [
        {
          id: "o1",
          productCode: "welvura-200",
          productName: "200 ₽ Welvura",
          priceAzc: "11111",
          status: "pending",
          createdAt: "2026-09-14T00:00:00.000Z",
          updatedAt: "2026-09-14T00:00:00.000Z",
          rejectionReason: null,
          submittedPreview: { welvuraId: "wv-1" },
        },
        {
          id: "o2",
          productCode: "donat",
          productName: "Донат на стрим",
          priceAzc: "1000",
          status: "rejected",
          createdAt: "2026-09-13T00:00:00.000Z",
          updatedAt: "2026-09-13T00:00:00.000Z",
          rejectionReason: "некорректный текст",
          submittedPreview: {},
        },
        {
          id: "o3",
          productCode: "welvura-bonus-3000",
          productName: "БОНУСКА ЗА 3000 ₽",
          priceAzc: "77777",
          status: "pending",
          createdAt: "2026-09-14T00:00:00.000Z",
          updatedAt: "2026-09-14T00:00:00.000Z",
          rejectionReason: null,
          submittedPreview: { welvuraId: "123456", slotName: "Sweet Bonanza" },
        },
        {
          id: "o4",
          productCode: "custom-slot",
          productName: "ЗАКАЗАТЬ СВОЙ СЛОТ",
          priceAzc: "5555",
          status: "processing",
          createdAt: "2026-09-14T00:00:00.000Z",
          updatedAt: "2026-09-14T00:00:00.000Z",
          rejectionReason: null,
          submittedPreview: { slotName: "Gates of Olympus" },
        },
      ],
    }),
  );
  assert.match(html, /В ожидании/);
  assert.match(html, /Отклонено/);
  assert.match(html, /некорректный текст/);
  assert.match(html, /Welvura ID: wv-1/);
  assert.match(html, /БОНУСКА ЗА 3000 ₽/);
  assert.match(html, /77 777/);
  assert.match(html, /Welvura ID: 123456/);
  assert.match(html, /Слот: Sweet Bonanza/);
  assert.match(html, /ЗАКАЗАТЬ СВОЙ СЛОТ/);
  assert.match(html, /Слот: Gates of Olympus/);
  assert.doesNotMatch(html, /AZC|payload|JSON/);
  assert.equal(friendlyShopStatus("fulfilled"), "Готово");
  assert.equal(friendlyShopStatus("processing"), "В обработке");
});

test("orders page empty state without remote data", () => {
  const html = renderToStaticMarkup(
    createElement(OrdersPage, { token: "t", skipRemote: true }),
  );
  assert.match(html, /У тебя пока нет заказов/);
  assert.match(html, /Перейти в магазин/);
});

test("admin shop orders view has process fulfill reject actions", () => {
  const html = renderToStaticMarkup(
    createElement(AdminShopOrdersView, {
      items: [
        {
          id: "o1",
          user: "user-1",
          productName: "200 ₽ Welvura",
          productCode: "welvura-200",
          priceAzc: "11111",
          status: "pending",
          submittedPayload: { welvuraId: "wv-1" },
          createdAt: "2026-09-14T00:00:00.000Z",
          rejectionReason: null,
          fulfillmentType: "manual",
        },
        {
          id: "o2",
          user: "user-2",
          productName: "Streak Freeze",
          productCode: "streak-freeze",
          priceAzc: "1000",
          status: "fulfilled",
          submittedPayload: {},
          createdAt: "2026-09-14T00:00:00.000Z",
          rejectionReason: null,
          fulfillmentType: "instant",
        },
        {
          id: "o3",
          user: "user-3",
          productName: "БОНУСКА ЗА 3000 ₽",
          productCode: "welvura-bonus-3000",
          priceAzc: "77777",
          status: "pending",
          submittedPayload: { welvuraId: "123456", slotName: "Sweet Bonanza" },
          createdAt: "2026-09-14T00:00:00.000Z",
          rejectionReason: null,
          fulfillmentType: "manual",
        },
        {
          id: "o4",
          user: "user-4",
          productName: "ЗАКАЗАТЬ СВОЙ СЛОТ",
          productCode: "custom-slot",
          priceAzc: "5555",
          status: "pending",
          submittedPayload: { slotName: "Gates of Olympus" },
          createdAt: "2026-09-14T00:00:00.000Z",
          rejectionReason: null,
          fulfillmentType: "manual",
        },
      ],
      status: "all",
      reason: "",
      onStatusChange: () => undefined,
      onReasonChange: () => undefined,
      onProcess: () => undefined,
      onFulfill: () => undefined,
      onReject: () => undefined,
    }),
  );
  assert.match(html, /В обработку/);
  assert.match(html, /Выполнено/);
  assert.match(html, /Отклонить/);
  assert.match(html, /Причина отклонения/);
  assert.match(html, /5 555/);
  assert.match(html, /77 777/);
  assert.match(html, /БОНУСКА ЗА 3000 ₽/);
  assert.match(html, /Welvura ID: 123456/);
  assert.match(html, /Слот: Sweet Bonanza/);
  assert.match(html, /ЗАКАЗАТЬ СВОЙ СЛОТ/);
  assert.match(html, /Слот: Gates of Olympus/);
  assert.doesNotMatch(html, /AZC|payload|JSON/);
  // Instant freeze has no admin action buttons after the first card's actions.
  assert.equal((html.match(/В обработку/g) ?? []).length, 3);
});

test("admin gif-stream orders send to moderation instead of fulfill", () => {
  const html = renderToStaticMarkup(
    createElement(AdminShopOrdersView, {
      items: [
        {
          id: "gif-order",
          user: "user-g",
          productName: "Медиа на стрим",
          productCode: "gif-stream",
          priceAzc: "1000",
          status: "fulfilled",
          submittedPayload: { gifUploadId: "666b71b2-44ba-45e2-a2a0-4dc9883afba8" },
          createdAt: "2026-10-08T10:34:47.000Z",
          rejectionReason: null,
          fulfillmentType: "manual",
        },
      ],
      status: "all",
      reason: "",
      onStatusChange: () => undefined,
      onReasonChange: () => undefined,
      onProcess: () => undefined,
      onFulfill: () => undefined,
      onApproveStream: () => undefined,
      onReject: () => undefined,
    }),
  );
  assert.match(html, /Одобрить и отправить на стрим/);
  assert.match(html, /#\/admin\/stream-gifs/);
  assert.doesNotMatch(html, />Выполнено</);
  assert.doesNotMatch(html, /666b71b2/);
  const shopViewSrc = readFileSync(join(process.cwd(), "src/shop/ShopView.tsx"), "utf8");
  assert.match(
    shopViewSrc,
    /const submissionId = item\.submittedPayload\.gifUploadId;/,
  );
  assert.match(
    shopViewSrc,
    /onClick=\{\(\) => onApproveStream\(submissionId\)\}/,
  );
  assert.doesNotMatch(shopViewSrc, /onApproveStream\(item\.id\)/);
});

test("shop product input focus uses local ring and does not blur the sheet", () => {
  const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
  const sheet = css.match(/\.sheet \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(sheet, /z-index:\s*100/);
  assert.match(sheet, /isolation:\s*isolate/);

  const backdrop = css.match(/\.sheet__backdrop \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(backdrop, /z-index:\s*0/);
  assert.doesNotMatch(backdrop, /backdrop-filter/);
  assert.doesNotMatch(backdrop, /-webkit-backdrop-filter/);
  assert.doesNotMatch(backdrop, /blur\(/);

  const giftBackdrop = css.match(/\.gift-overlay__backdrop \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(giftBackdrop, /backdrop-filter/);
  assert.doesNotMatch(giftBackdrop, /blur\(/);

  const adminBackdrop = css.match(/\.admin-modal__backdrop \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(adminBackdrop, /backdrop-filter/);
  assert.doesNotMatch(adminBackdrop, /blur\(/);

  assert.match(css, /\.shop-field input,[\s\S]*?font-size:\s*16px;/);

  const panel = css.match(/\.sheet__panel \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(panel, /isolation:\s*isolate/);
  assert.match(panel, /z-index:\s*1/);
  assert.match(panel, /backdrop-filter:\s*none/);
  assert.doesNotMatch(css, /\.sheet:focus-within/);
  assert.doesNotMatch(css, /\.sheet__panel:focus-within/);
  assert.doesNotMatch(css, /\.shop-product-sheet:focus-within/);

  const gift = css.match(/\.gift-overlay \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(gift, /z-index:\s*120/);
  assert.match(gift, /isolation:\s*isolate/);

  const nav = css.match(/\.bottom-nav \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(nav, /z-index:\s*20/);

  const shopFocus = css.match(
    /\.shop-field input:focus,[\s\S]*?\.shop-field textarea:focus-visible \{[\s\S]*?\n\}/,
  )?.[0] ?? "";
  assert.match(shopFocus, /box-shadow:/);
  assert.match(shopFocus, /outline:\s*none/);
  assert.doesNotMatch(shopFocus, /outline:\s*2px/);
  assert.doesNotMatch(shopFocus, /backdrop-filter/);
  assert.doesNotMatch(shopFocus, /filter:\s*blur/);

  const sheetSrc = readFileSync(join(process.cwd(), "src/components/BottomSheet.tsx"), "utf8");
  assert.match(sheetSrc, /OverlayPortal/);
  const portalSrc = readFileSync(join(process.cwd(), "src/components/OverlayPortal.tsx"), "utf8");
  assert.match(portalSrc, /createPortal/);
  assert.match(portalSrc, /document\.body/);
});
