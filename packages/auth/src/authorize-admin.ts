import {
  adminPermissions,
  adminRoleAssignments,
  adminRolePermissions,
  adminRoles,
  users,
} from "@giftbot/db/schema";
import type { GiftbotDb } from "@giftbot/domain";
import { eq } from "drizzle-orm";
import { ForbiddenError, SessionUnauthorizedError } from "./errors.js";
import { resolveAdminSession } from "./session.js";

export const ADMIN_PERMISSIONS = {
  usersRead: "users.read",
  walletRead: "wallet.read",
  walletAdjust: "wallet.adjust",
  promoRead: "promo.read",
  promoWrite: "promo.write",
  gramRead: "gram.read",
  gramWrite: "gram.write",
  shopRead: "shop.read",
  shopWrite: "shop.write",
  cashRead: "cash.read",
  cashWrite: "cash.write",
  welvuraRead: "welvura.read",
  welvuraWrite: "welvura.write",
  giveawayRead: "giveaway.read",
  giveawayWrite: "giveaway.write",
  broadcastRead: "broadcast.read",
  broadcastWrite: "broadcast.write",
  contestRead: "contest.read",
  contestWrite: "contest.write",
} as const;

export async function listAssignedAdminRoles(
  db: GiftbotDb,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ name: adminRoles.name })
    .from(adminRoleAssignments)
    .innerJoin(adminRoles, eq(adminRoleAssignments.roleId, adminRoles.id))
    .where(eq(adminRoleAssignments.userId, userId));
  return rows.map((row) => row.name);
}

export async function authorizeAdmin(
  db: GiftbotDb,
  token: string,
  permission: string,
): Promise<{
  userId: string;
  sessionId: string;
  expiresAt: Date;
  roles: string[];
}> {
  const session = await resolveAdminSession(db, token);
  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  const user = userRows[0];
  if (!user || user.status !== "active") {
    throw new SessionUnauthorizedError();
  }
  const roles = await listAssignedAdminRoles(db, session.userId);
  if (roles.length === 0) {
    throw new ForbiddenError("admin role is required");
  }
  if (roles.includes("super_admin")) {
    return { ...session, roles };
  }
  const granted = await db
    .select({ key: adminPermissions.key })
    .from(adminRoleAssignments)
    .innerJoin(
      adminRolePermissions,
      eq(adminRolePermissions.roleId, adminRoleAssignments.roleId),
    )
    .innerJoin(
      adminPermissions,
      eq(adminPermissions.id, adminRolePermissions.permissionId),
    )
    .where(eq(adminRoleAssignments.userId, session.userId));
  if (!granted.some((row) => row.key === permission)) {
    throw new ForbiddenError("admin permission is required");
  }
  return { ...session, roles };
}
