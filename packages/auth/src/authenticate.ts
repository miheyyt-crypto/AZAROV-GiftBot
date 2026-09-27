import type { GiftbotDb } from "@giftbot/domain";
import { UserBlockedError, identifyTelegramUser } from "@giftbot/domain";
import { ForbiddenError } from "./errors.js";
import { verifyTelegramInitData } from "./init-data.js";
import type { AuthPolicy } from "./policy.js";
import {
  revokeAllAdminSessions,
  revokeAllMiniAppSessions,
  rotateMiniAppSession,
  type IssuedSession,
} from "./session.js";

export type AuthDatabase = GiftbotDb;

export type AuthUserView = {
  userId: string;
  publicId: string;
};

export type MiniAppAuthResult = IssuedSession & {
  user: AuthUserView;
};

export async function rejectBlockedUser(
  db: GiftbotDb,
  error: unknown,
): Promise<never> {
  if (error instanceof UserBlockedError) {
    if (error.userId) {
      await revokeAllMiniAppSessions(db, error.userId);
      await revokeAllAdminSessions(db, error.userId);
    }
    throw new ForbiddenError("user is blocked");
  }
  throw error;
}

export async function authenticateMiniApp(
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

  try {
    const identity = await identifyTelegramUser(db, verified.user);
    const session = await rotateMiniAppSession(db, {
      userId: identity.userId,
      ttlSeconds: policy.sessionTtlSeconds,
    });
    return {
      ...session,
      user: { userId: identity.userId, publicId: identity.publicId },
    };
  } catch (error) {
    return rejectBlockedUser(db, error);
  }
}
