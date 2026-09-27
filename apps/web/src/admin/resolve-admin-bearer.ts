import { authenticateAdmin } from "../api.js";
import { readDevAdminToken } from "../session.js";
import { readTelegramInitData } from "../telegram.js";

/**
 * Prefer cached local-dev admin session; otherwise Telegram initData admin auth.
 */
export async function resolveAdminBearer(): Promise<string> {
  const cachedDev = readDevAdminToken(window.sessionStorage);
  if (cachedDev) {
    return cachedDev;
  }
  const initData = readTelegramInitData();
  if (!initData) {
    if (import.meta.env.DEV) {
      throw new Error(
        "Local admin needs ?dev=admin (or Telegram initData). User mode has no admin token.",
      );
    }
    throw new Error("telegram_required");
  }
  const auth = await authenticateAdmin(initData);
  return auth.token;
}
