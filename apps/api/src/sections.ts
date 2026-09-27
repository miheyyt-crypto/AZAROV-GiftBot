import type { AuthDatabase } from "@giftbot/auth";
import { resolveMiniAppSession } from "@giftbot/auth";
import { games } from "@giftbot/db/schema";
import { readAllowedBets } from "@giftbot/domain";
import type { RateLimiter } from "@giftbot/rate-limit";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { readBootstrap } from "./bootstrap.js";
import { ApiError, sendHttpError } from "./errors.js";
import { consumeAuthed } from "./http-limit.js";
import { readBearer } from "./http-auth.js";

export const MINI_APP_SECTIONS = ["home", "referrals", "kick", "games"] as const;
export type MiniAppSection = (typeof MINI_APP_SECTIONS)[number];

function isMiniAppSection(value: string): value is MiniAppSection {
  return (MINI_APP_SECTIONS as readonly string[]).includes(value);
}

export function readSectionPayload(
  section: MiniAppSection,
  bootstrap?: Awaited<ReturnType<typeof readBootstrap>>,
  catalog?: {
    games: Array<{
      id: string;
      slug: string;
      title: string;
      settlementMode: string;
      allowedBetMinor: string[];
    }>;
  },
) {
  if (section === "games") {
    return {
      section,
      available: true as const,
      games: catalog?.games ?? [],
    };
  }
  if (section === "referrals") {
    return {
      section,
      available: true as const,
      referralCode: bootstrap?.referralCode ?? "",
      referralsAttributed: bootstrap?.counters.referralsAttributed ?? 0,
    };
  }
  if (section === "kick") {
    return {
      section,
      available: true as const,
      kickLinked: Boolean(bootstrap?.flags.kickLinked),
    };
  }
  return {
    section,
    available: true as const,
  };
}

export function registerSectionRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  limiter?: RateLimiter,
): void {
  app.get("/sections/:section", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "section", session.userId);
      const section = (request.params as { section?: string }).section ?? "";
      if (!isMiniAppSection(section)) {
        throw new ApiError("NOT_FOUND", "section is not available", 404);
      }
      if (section === "home") {
        return readSectionPayload(section);
      }
      const bootstrap = await readBootstrap(db, session.userId);
      if (section === "games") {
        const rows = await db.select().from(games).where(eq(games.status, "active"));
        return readSectionPayload(section, bootstrap, {
          games: rows.map((row) => {
            let allowedBetMinor: string[] = [];
            try {
              allowedBetMinor = (readAllowedBets(row.config) ?? []).map((amount) =>
                amount.toString(),
              );
            } catch {
              allowedBetMinor = [];
            }
            return {
              id: row.id,
              slug: row.slug,
              title: row.title,
              settlementMode: row.settlementMode,
              allowedBetMinor,
            };
          }),
        });
      }
      return readSectionPayload(section, bootstrap);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });
}
