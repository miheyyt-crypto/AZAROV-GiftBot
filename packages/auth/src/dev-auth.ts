import type { GiftbotDb } from "@giftbot/domain";
import {
  ensureDevLocalIdentity,
  type DevLocalRole,
} from "@giftbot/domain";
import type { AuthPolicy } from "./policy.js";
import { rotateAdminSession, rotateMiniAppSession } from "./session.js";

export type DevAuthResult = {
  role: DevLocalRole;
  token: string;
  expiresAt: Date;
  sessionId: string;
  user: { userId: string; publicId: string };
  adminToken?: string;
  adminExpiresAt?: Date;
};

/**
 * Local-only auth. Caller MUST gate with isDevAuthEnabled before invoking.
 * Issues a real Mini App session (and admin session for role=admin).
 */
export async function authenticateDevLocal(
  db: GiftbotDb,
  policy: Pick<AuthPolicy, "sessionTtlSeconds" | "adminSessionTtlSeconds">,
  role: DevLocalRole,
): Promise<DevAuthResult> {
  const identity = await ensureDevLocalIdentity(db, role);
  const session = await rotateMiniAppSession(db, {
    userId: identity.userId,
    ttlSeconds: policy.sessionTtlSeconds,
    authSource: "dev_local",
  });

  const result: DevAuthResult = {
    role,
    token: session.token,
    expiresAt: session.expiresAt,
    sessionId: session.sessionId,
    user: { userId: identity.userId, publicId: identity.publicId },
  };

  if (role === "admin") {
    const admin = await rotateAdminSession(db, {
      userId: identity.userId,
      ttlSeconds: policy.adminSessionTtlSeconds,
    });
    result.adminToken = admin.token;
    result.adminExpiresAt = admin.expiresAt;
  }

  return result;
}
