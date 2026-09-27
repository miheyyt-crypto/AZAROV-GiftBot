import { adminRoleAssignments, telegramAccounts, users } from "@giftbot/db/schema";
import type { GiftbotDb } from "@giftbot/domain";
import { eq } from "drizzle-orm";
import type { MiniAppAuthResult } from "./authenticate.js";
import { ForbiddenError } from "./errors.js";
import { verifyTelegramInitData } from "./init-data.js";
import type { AuthPolicy } from "./policy.js";
import {
  revokeAllAdminSessions,
  revokeAllMiniAppSessions,
  rotateAdminSession,
} from "./session.js";

export async function requireAdminRole(
  db: GiftbotDb,
  userId: string,
): Promise<void> {
  const assignments = await db
    .select({ id: adminRoleAssignments.id })
    .from(adminRoleAssignments)
    .where(eq(adminRoleAssignments.userId, userId))
    .limit(1);
  if (!assignments[0]) {
    throw new ForbiddenError("admin role is required");
  }
}

export async function authenticateAdmin(
  db: GiftbotDb,
  initData: string,
  policy: AuthPolicy,
  now = new Date(),
): Promise<MiniAppAuthResult> {
  const verified = verifyTelegramInitData(
    initData,
    policy.botToken,
    now,
    policy.initDataMaxAgeSeconds,
  );

  const accounts = await db
    .select()
    .from(telegramAccounts)
    .where(eq(telegramAccounts.telegramUserId, verified.user.telegramUserId))
    .limit(1);
  const account = accounts[0];
  if (!account) {
    throw new ForbiddenError("admin role is required");
  }

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.id, account.userId))
    .limit(1);
  const user = userRows[0];
  if (!user || user.status !== "active") {
    await revokeAllMiniAppSessions(db, account.userId);
    await revokeAllAdminSessions(db, account.userId);
    throw new ForbiddenError("user is blocked");
  }

  await requireAdminRole(db, user.id);
  const session = await rotateAdminSession(db, {
    userId: user.id,
    ttlSeconds: policy.adminSessionTtlSeconds,
  });
  return {
    ...session,
    user: { userId: user.id, publicId: user.publicId },
  };
}
