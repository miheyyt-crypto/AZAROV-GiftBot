import { adminSessions, sessions, users } from "@giftbot/db/schema";
import type { GiftbotDb, GiftbotTx } from "@giftbot/domain";
import { and, eq, isNull } from "drizzle-orm";
import { ForbiddenError, SessionUnauthorizedError } from "./errors.js";
import { hashToken, issueOpaqueToken } from "./tokens.js";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}

export type IssuedSession = {
  token: string;
  expiresAt: Date;
  sessionId: string;
};

async function assertActiveUser(tx: GiftbotTx, userId: string): Promise<void> {
  const rows = await tx
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = rows[0];
  if (!user || user.status !== "active") {
    throw new ForbiddenError("user is blocked or deleted");
  }
}

export async function rotateMiniAppSession(
  db: GiftbotDb,
  input: {
    userId: string;
    ttlSeconds: number;
    ipHash?: string;
    userAgentHash?: string;
    authSource?: string;
  },
): Promise<IssuedSession> {
  try {
    return await rotateMiniAppSessionOnce(db, input);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return rotateMiniAppSessionOnce(db, input);
    }
    throw error;
  }
}

async function rotateMiniAppSessionOnce(
  db: GiftbotDb,
  input: {
    userId: string;
    ttlSeconds: number;
    ipHash?: string;
    userAgentHash?: string;
    authSource?: string;
  },
): Promise<IssuedSession> {
  return db.transaction(async (tx) => {
    await assertActiveUser(tx, input.userId);
    const now = new Date();
    await tx
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, input.userId), isNull(sessions.revokedAt)));

    const token = issueOpaqueToken();
    const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000);
    const inserted = await tx
      .insert(sessions)
      .values({
        userId: input.userId,
        tokenHash: hashToken(token),
        expiresAt,
        ...(input.ipHash ? { ipHash: input.ipHash } : {}),
        ...(input.userAgentHash ? { userAgentHash: input.userAgentHash } : {}),
        authSource: input.authSource ?? "telegram_init_data",
      })
      .returning();
    const row = inserted[0];
    if (!row) {
      throw new Error("failed to create session");
    }
    return { token, expiresAt, sessionId: row.id };
  });
}

export async function resolveMiniAppSession(
  db: GiftbotDb,
  token: string,
): Promise<{ userId: string; sessionId: string; expiresAt: Date }> {
  const hashed = hashToken(token);
  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, hashed))
    .limit(1);
  const session = rows[0];
  const now = new Date();
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt.getTime() <= now.getTime()
  ) {
    throw new SessionUnauthorizedError();
  }

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  if (!userRows[0] || userRows[0].status !== "active") {
    throw new SessionUnauthorizedError();
  }

  return {
    userId: session.userId,
    sessionId: session.id,
    expiresAt: session.expiresAt,
  };
}

export async function touchMiniAppSessionLastUsed(
  db: GiftbotDb,
  sessionId: string,
): Promise<void> {
  await db
    .update(sessions)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

export async function logoutMiniAppSession(
  db: GiftbotDb,
  token: string,
): Promise<void> {
  const hashed = hashToken(token);
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, hashed), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  if (!revoked[0]) {
    throw new SessionUnauthorizedError();
  }
}

export async function countActiveMiniAppSessions(
  db: GiftbotDb,
  userId: string,
): Promise<number> {
  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  return rows.length;
}

export async function revokeAllMiniAppSessions(
  db: GiftbotDb,
  userId: string,
): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export async function rotateAdminSession(
  db: GiftbotDb,
  input: {
    userId: string;
    ttlSeconds: number;
    ipHash?: string;
    userAgentHash?: string;
  },
): Promise<IssuedSession> {
  try {
    return await rotateAdminSessionOnce(db, input);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return rotateAdminSessionOnce(db, input);
    }
    throw error;
  }
}

async function rotateAdminSessionOnce(
  db: GiftbotDb,
  input: {
    userId: string;
    ttlSeconds: number;
    ipHash?: string;
    userAgentHash?: string;
  },
): Promise<IssuedSession> {
  return db.transaction(async (tx) => {
    await assertActiveUser(tx, input.userId);
    const now = new Date();
    await tx
      .update(adminSessions)
      .set({ revokedAt: now })
      .where(
        and(eq(adminSessions.userId, input.userId), isNull(adminSessions.revokedAt)),
      );

    const token = issueOpaqueToken();
    const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000);
    const inserted = await tx
      .insert(adminSessions)
      .values({
        userId: input.userId,
        tokenHash: hashToken(token),
        expiresAt,
        ...(input.ipHash ? { ipHash: input.ipHash } : {}),
        ...(input.userAgentHash ? { userAgentHash: input.userAgentHash } : {}),
      })
      .returning();
    const row = inserted[0];
    if (!row) {
      throw new Error("failed to create admin session");
    }
    return { token, expiresAt, sessionId: row.id };
  });
}

export async function resolveAdminSession(
  db: GiftbotDb,
  token: string,
): Promise<{ userId: string; sessionId: string; expiresAt: Date }> {
  const hashed = hashToken(token);
  const rows = await db
    .select()
    .from(adminSessions)
    .where(eq(adminSessions.tokenHash, hashed))
    .limit(1);
  const session = rows[0];
  const now = new Date();
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt.getTime() <= now.getTime()
  ) {
    throw new SessionUnauthorizedError();
  }
  return {
    userId: session.userId,
    sessionId: session.id,
    expiresAt: session.expiresAt,
  };
}

export async function logoutAdminSession(
  db: GiftbotDb,
  token: string,
): Promise<void> {
  const hashed = hashToken(token);
  const revoked = await db
    .update(adminSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(adminSessions.tokenHash, hashed), isNull(adminSessions.revokedAt)),
    )
    .returning({ id: adminSessions.id });
  if (!revoked[0]) {
    throw new SessionUnauthorizedError();
  }
}

export async function countActiveAdminSessions(
  db: GiftbotDb,
  userId: string,
): Promise<number> {
  const rows = await db
    .select()
    .from(adminSessions)
    .where(and(eq(adminSessions.userId, userId), isNull(adminSessions.revokedAt)));
  return rows.length;
}

export async function revokeAllAdminSessions(
  db: GiftbotDb,
  userId: string,
): Promise<void> {
  await db
    .update(adminSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(adminSessions.userId, userId), isNull(adminSessions.revokedAt)),
    );
}
