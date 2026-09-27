import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InlineKeyboard } from "grammy";

export const START_WELCOME_CAPTION = [
  "✨Добро пожаловать в AZAROV GIFTBOT!",
  "",
  "Смотри эфиры AZAROV на KICK, выполняй задания и копи монеты. Обменивай их в магазине на приветы, активности в эфире, подписки, пополнения и ценные призы.",
  "",
  "Не пропускай стримы, сохраняй серию и забирай ежедневные бонусы. Погнали фармить! 🎁",
].join("\n");

export const START_LAUNCH_BUTTON_TEXT = "🚀 Запустить";

export const START_BANNER_FILENAME = "start-banner.jpg";

export function startBannerPathCandidates(
  cwd = process.cwd(),
  moduleDir = path.dirname(fileURLToPath(import.meta.url)),
): string[] {
  const packageRoot = path.resolve(moduleDir, "..");
  return [
    path.join(cwd, "apps", "bot", "assets", START_BANNER_FILENAME),
    path.join(cwd, "apps", "bot", "dist", "assets", START_BANNER_FILENAME),
    path.join(packageRoot, "assets", START_BANNER_FILENAME),
    path.join(packageRoot, "dist", "assets", START_BANNER_FILENAME),
    path.join(moduleDir, "assets", START_BANNER_FILENAME),
  ];
}

export function resolveStartBannerPath(
  cwd = process.cwd(),
  moduleDir = path.dirname(fileURLToPath(import.meta.url)),
): string | undefined {
  for (const candidate of startBannerPathCandidates(cwd, moduleDir)) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function resolveMiniAppUrl(publicBaseUrl: string | undefined): string | undefined {
  const raw = publicBaseUrl?.trim();
  if (!raw) {
    return undefined;
  }
  return raw.replace(/\/+$/, "");
}

export function startWelcomeReplyMarkup(miniAppUrl: string): InlineKeyboard {
  return new InlineKeyboard().webApp(START_LAUNCH_BUTTON_TEXT, miniAppUrl);
}
