import { sessions } from "@giftbot/db/schema";
import { and, gt, isNotNull, isNull, sql } from "drizzle-orm";
import type { GiftbotDb } from "./db.js";

/** Operational window for “online now” (not a product economy value). */
export const MINI_APP_ONLINE_WINDOW_MS = 5 * 60 * 1000;

export async function countMiniAppOnline(
  db: GiftbotDb,
  now = new Date(),
): Promise<number> {
  const since = new Date(now.getTime() - MINI_APP_ONLINE_WINDOW_MS);
  const rows = await db
    .select({
      n: sql`count(distinct ${sessions.userId})::int`.mapWith(Number),
    })
    .from(sessions)
    .where(
      and(
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        isNotNull(sessions.lastUsedAt),
        gt(sessions.lastUsedAt, since),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

export function formatMiniAppOnlineMessage(onlineCount: number): string {
  return [
    `Онлайн в приложении: ${onlineCount}`,
    "",
    "Считаются пользователи Mini App с активностью за последние 5 минут.",
  ].join("\n");
}
