import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  resolveMiniAppUrl,
  resolveStartBannerPath,
  START_BANNER_FILENAME,
  START_LAUNCH_BUTTON_TEXT,
  START_WELCOME_CAPTION,
  startBannerPathCandidates,
  startWelcomeReplyMarkup,
} from "./start-welcome.js";

test("start banner exists at the package asset path", () => {
  const resolved = resolveStartBannerPath();
  assert.ok(resolved, "start-banner.jpg must resolve");
  assert.equal(existsSync(resolved), true);
  assert.match(resolved.replaceAll("\\", "/"), /assets\/start-banner\.jpg$/);
});

test("production WorkingDirectory candidate includes apps/bot/assets", () => {
  const candidates = startBannerPathCandidates("/opt/giftbot/current");
  assert.equal(
    candidates[0]?.replaceAll("\\", "/"),
    `/opt/giftbot/current/apps/bot/assets/${START_BANNER_FILENAME}`,
  );
});

test("Mini App URL comes from PUBLIC_BASE_URL without a trailing slash", () => {
  assert.equal(
    resolveMiniAppUrl("https://azarovgift.xyz/"),
    "https://azarovgift.xyz",
  );
  const markup = startWelcomeReplyMarkup("https://azarovgift.xyz");
  assert.deepEqual(markup.inline_keyboard[0]?.[0], {
    text: START_LAUNCH_BUTTON_TEXT,
    web_app: { url: "https://azarovgift.xyz" },
  });
});

test("welcome caption is the product copy", () => {
  assert.equal(
    START_WELCOME_CAPTION,
    [
      "✨Добро пожаловать в AZAROV GIFTBOT!",
      "",
      "Смотри эфиры AZAROV на KICK, выполняй задания и копи монеты. Обменивай их в магазине на приветы, активности в эфире, подписки, пополнения и ценные призы.",
      "",
      "Не пропускай стримы, сохраняй серию и забирай ежедневные бонусы. Погнали фармить! 🎁",
    ].join("\n"),
  );
});

test("asset path is independent of auth and referral economics", () => {
  assert.ok(path.basename(START_BANNER_FILENAME) === "start-banner.jpg");
});
