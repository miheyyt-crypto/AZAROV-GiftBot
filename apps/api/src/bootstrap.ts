import type { AuthDatabase } from "@giftbot/auth";
import { listAssignedAdminRoles, resolveMiniAppSession } from "@giftbot/auth";
import type { RateLimiter } from "@giftbot/rate-limit";
import {
  appConfig,
  kickAccounts,
  referralCodes,
  referrals,
  telegramAccounts,
  users,
  wallets,
} from "@giftbot/db/schema";
import { and, count, eq } from "drizzle-orm";
import { publicAvatarUrl } from "@giftbot/domain";
import type { FastifyInstance } from "fastify";
import { sendHttpError } from "./errors.js";
import { consumeAuthed } from "./http-limit.js";
import { readBearer } from "./http-auth.js";

function configVersionFromValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (value && typeof value === "object" && "version" in value) {
    const version = value.version;
    if (typeof version === "string" || typeof version === "number") {
      return String(version);
    }
  }
  return "0";
}

export async function readBootstrap(db: AuthDatabase, userId: string) {
  const [
    userRows,
    walletRows,
    codeRows,
    telegramRows,
    kickRows,
    referralCountRows,
    configRows,
    adminRoles,
  ] =
    await Promise.all([
      db.select().from(users).where(eq(users.id, userId)).limit(1),
      db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1),
      db
        .select()
        .from(referralCodes)
        .where(and(eq(referralCodes.userId, userId), eq(referralCodes.isActive, true)))
        .limit(1),
      db
        .select({ photoUrl: telegramAccounts.photoUrl })
        .from(telegramAccounts)
        .where(
          and(eq(telegramAccounts.userId, userId), eq(telegramAccounts.isActive, true)),
        )
        .limit(1),
      db
        .select({ id: kickAccounts.id })
        .from(kickAccounts)
        .where(and(eq(kickAccounts.userId, userId), eq(kickAccounts.status, "active")))
        .limit(1),
      db
        .select({ value: count() })
        .from(referrals)
        .where(eq(referrals.referrerUserId, userId)),
      db.select().from(appConfig).where(eq(appConfig.key, "config_version")).limit(1),
      listAssignedAdminRoles(db, userId),
    ]);

  const user = userRows[0];
  const wallet = walletRows[0];
  const referralCode = codeRows[0];
  if (!user || !wallet || !referralCode) {
    throw new Error("bootstrap user is missing required rows");
  }

  return {
    user: {
      publicId: user.publicId,
      ...(user.displayName ? { displayName: user.displayName } : {}),
      avatarUrl: publicAvatarUrl(telegramRows[0]?.photoUrl),
    },
    wallet: {
      balanceMinor: wallet.balanceMinor.toString(),
      currencyCode: wallet.currencyCode,
    },
    flags: {
      kickLinked: Boolean(kickRows[0]),
      isSuperAdmin: adminRoles.includes("super_admin"),
    },
    counters: {
      referralsAttributed: Number(referralCountRows[0]?.value ?? 0),
    },
    referralCode: referralCode.code,
    configVersion: configVersionFromValue(configRows[0]?.value),
  };
}

export function registerBootstrapRoute(
  app: FastifyInstance,
  db: AuthDatabase,
  limiter?: RateLimiter,
): void {
  app.get("/bootstrap", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "bootstrap", session.userId);
      const body = await readBootstrap(db, session.userId);
      return {
        ...body,
        session: { expiresAt: session.expiresAt.toISOString() },
      };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });
}
