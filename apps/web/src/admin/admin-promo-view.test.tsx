import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminPromoView } from "./AdminPromoView.js";
import { friendlyPromoError } from "../profile/promo-messages.js";

test("admin promo view renders list, create form, and deactivate", () => {
  const html = renderToStaticMarkup(
    createElement(AdminPromoView, {
      items: [
        {
          id: "p1",
          code: "AZAROV",
          reward: "999",
          used: 1,
          limit: 100,
          status: "active",
          createdAt: "2026-09-14T00:00:00.000Z",
          deactivatedAt: null,
        },
      ],
      code: "",
      rewardAzc: "999",
      activationLimit: "100",
      onCodeChange: () => undefined,
      onRewardChange: () => undefined,
      onLimitChange: () => undefined,
      onCreate: () => undefined,
      onDeactivate: () => undefined,
    }),
  );
  assert.match(html, /Новый промокод/);
  assert.match(html, /AZAROV/);
  assert.match(html, /999 AZC/);
  assert.match(html, /Деактивировать/);
  assert.match(html, /Создать/);
});

test("promo errors stay user-friendly", () => {
  assert.equal(friendlyPromoError("PROMO_NOT_FOUND"), "Промокод не найден");
  assert.equal(
    friendlyPromoError("PROMO_ALREADY_REDEEMED"),
    "Этот промокод уже использован",
  );
  assert.equal(
    friendlyPromoError("PROMO_LIMIT_REACHED"),
    "Лимит активаций закончился",
  );
  assert.equal(friendlyPromoError("PROMO_INACTIVE"), "Промокод больше не активен");
  assert.doesNotMatch(friendlyPromoError("SQLSTATE_23505"), /SQL|23505/);
});
