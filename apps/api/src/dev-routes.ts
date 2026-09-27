import {
  authenticateDevLocal,
  resolveMiniAppSession,
  type AuthDatabase,
  type AuthPolicy,
} from "@giftbot/auth";
import {
  attributeReferral,
  ConflictError,
  applyKickChatMessage,
  drawGiveawayNowForDev,
  endKickStreamSession,
  evaluateAchievementsForUser,
  finalizeKickStreamSession,
  linkKickAccount,
  markBotStarted,
  onKickAccountLinked,
  provisionUser,
  readReferralMe,
  readStreamStreakState,
  setTaskEvidenceForTests,
  startKickStreamSession,
  KICK_TARGET_CHANNEL,
  type DevLocalRole,
} from "@giftbot/domain";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ApiError, sendHttpError } from "./errors.js";
import { readBearer } from "./http-auth.js";

function readRole(body: unknown): DevLocalRole {
  if (typeof body !== "object" || body === null) {
    return "user";
  }
  const role = (body as { role?: unknown }).role;
  if (role === undefined || role === null || role === "user") {
    return "user";
  }
  if (role === "admin") {
    return "admin";
  }
  throw new ApiError("BAD_REQUEST", "role must be user or admin", 400);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function readCode(body: unknown): string {
  const record = asRecord(body);
  const code = record?.code;
  if (typeof code !== "string" || code.trim().length === 0) {
    throw new ApiError("BAD_REQUEST", "code is required", 400);
  }
  return code.trim();
}

function readQaSeedCount(body: unknown): number {
  const record = asRecord(body);
  const raw = record?.count;
  if (raw === undefined) {
    return 5;
  }
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ApiError("BAD_REQUEST", "count must be a positive integer", 400);
  }
  return Math.min(parsed, 15);
}

/**
 * Registers POST /dev/auth only when the caller already verified
 * NODE_ENV !== production && ALLOW_DEV_AUTH === true.
 */
export function registerDevAuthRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  policy: AuthPolicy,
): void {
  app.post("/dev/auth", async (request, reply) => {
    try {
      const role = readRole(request.body);
      const result = await authenticateDevLocal(db, policy, role);
      const body: Record<string, unknown> = {
        role: result.role,
        token: result.token,
        expiresAt: result.expiresAt.toISOString(),
        user: result.user,
      };
      if (result.adminToken && result.adminExpiresAt) {
        body.adminToken = result.adminToken;
        body.adminExpiresAt = result.adminExpiresAt.toISOString();
      }
      return body;
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/dev/referrals/attribute", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      const code = readCode(request.body);
      try {
        await attributeReferral(db, {
          refereeUserId: session.userId,
          code,
        });
        return { ok: true as const };
      } catch (error) {
        if (error instanceof ConflictError && /self-referral/i.test(error.message)) {
          return { ok: true as const, ignored: true as const };
        }
        throw error;
      }
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/dev/referrals/:userId/activate-kick", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      const params = request.params as { userId?: string };
      const userId = params.userId ?? "";
      if (userId !== session.userId) {
        throw new ApiError("FORBIDDEN", "can only activate own user", 403);
      }
      await linkKickAccount(db, {
        userId,
        kickUserId: `dev-kick-${userId}`,
      });
      const activation = await onKickAccountLinked(db, userId);
      return { ok: true as const, activation };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/dev/referrals/qa-seed", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      const count = readQaSeedCount(request.body);
      const me = await readReferralMe(db, {
        userId: session.userId,
        botUsername: "giftbot",
      });
      let activated = 0;
      let milestonesGranted = 0;
      for (let i = 0; i < count; i += 1) {
        const referee = await provisionUser(db);
        await attributeReferral(db, {
          refereeUserId: referee.userId,
          code: me.token,
        });
        await linkKickAccount(db, {
          userId: referee.userId,
          kickUserId: `dev-kick-${referee.userId}`,
        });
        const result = await onKickAccountLinked(db, referee.userId);
        if (result.activated) {
          activated += 1;
        }
        if (result.milestoneGranted) {
          milestonesGranted += 1;
        }
      }
      const after = await readReferralMe(db, {
        userId: session.userId,
        botUsername: "giftbot",
      });
      return {
        ok: true as const,
        seeded: count,
        activated,
        milestonesGranted,
        stats: after.stats,
        caseProgress: after.caseProgress,
      };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/dev/tasks/evidence", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      const record = asRecord(request.body) ?? {};
      const patch: {
        botStartedAt?: Date | null;
        telegramChannelMemberAt?: Date | null;
        kickFollowAzarovAt?: Date | null;
        kickNicknameSnapshot?: string | null;
      } = {};
      if (record.botStarted === true) {
        patch.botStartedAt = new Date();
      }
      if (record.telegramChannelMember === true) {
        patch.telegramChannelMemberAt = new Date();
      }
      if (record.kickFollow === true) {
        patch.kickFollowAzarovAt = new Date();
      }
      if (typeof record.kickNickname === "string") {
        patch.kickNicknameSnapshot = record.kickNickname;
      }
      if (Object.keys(patch).length === 0) {
        throw new ApiError(
          "BAD_REQUEST",
          "provide botStarted, telegramChannelMember, kickFollow, and/or kickNickname",
          400,
        );
      }
      if (patch.botStartedAt) {
        await markBotStarted(db, session.userId, patch.botStartedAt);
      }
      await setTaskEvidenceForTests(db, session.userId, patch);
      return { ok: true as const };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/dev/kick/link", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      const kickUserId = `dev-kick-${session.userId}`;
      await linkKickAccount(db, { userId: session.userId, kickUserId });
      return { ok: true as const, kickUserId };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/dev/kick/stream/start", async (request, reply) => {
    try {
      await resolveMiniAppSession(db, readBearer(request.headers.authorization));
      const record = asRecord(request.body) ?? {};
      const providerStreamId =
        typeof record.providerStreamId === "string"
          ? record.providerStreamId
          : `dev-stream-${Date.now()}`;
      const started = await startKickStreamSession(db, {
        channel: KICK_TARGET_CHANNEL,
        providerStreamId,
      });
      return { ok: true as const, ...started, providerStreamId };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/dev/kick/stream/end", async (request, reply) => {
    try {
      await resolveMiniAppSession(db, readBearer(request.headers.authorization));
      const ended = await endKickStreamSession(db, {
        channel: KICK_TARGET_CHANNEL,
      });
      if (ended.sessionId) {
        let guard = 0;
        while (guard < 100) {
          const result = await finalizeKickStreamSession(db, ended.sessionId);
          if (result.done) {
            break;
          }
          guard += 1;
        }
      }
      return { ok: true as const, ...ended };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/dev/kick/chat/messages", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      const record = asRecord(request.body) ?? {};
      const countRaw = record.count;
      const count =
        typeof countRaw === "number"
          ? Math.min(Math.max(1, Math.floor(countRaw)), 50)
          : 1;
      const kickUserId =
        typeof record.kickUserId === "string"
          ? record.kickUserId
          : `dev-kick-${session.userId}`;
      await linkKickAccount(db, { userId: session.userId, kickUserId });
      const results = [];
      for (let i = 0; i < count; i += 1) {
        const providerMessageId =
          typeof record.messageId === "string" && count === 1
            ? record.messageId
            : `dev-msg-${session.userId}-${Date.now()}-${i}`;
        const applied = await applyKickChatMessage(db, {
          providerMessageId,
          kickUserId,
          channel: KICK_TARGET_CHANNEL,
        });
        results.push({ providerMessageId, ...applied });
      }
      const streak = await readStreamStreakState(db, session.userId);
      return { ok: true as const, results, streak };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/dev/giveaways/:id/draw-now", async (request, reply) => {
    try {
      await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      const params = request.params as { id?: string };
      const giveawayId = params.id ?? "";
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          giveawayId,
        )
      ) {
        throw new ApiError("BAD_REQUEST", "giveaway id is invalid", 400);
      }
      const drawn = await drawGiveawayNowForDev(db, giveawayId);
      return { ok: true as const, ...drawn };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/dev/achievements/evaluate", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      const evaluated = await evaluateAchievementsForUser(db, session.userId);
      return { ok: true as const, ...evaluated };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });
}

/** Explicit 404 when the route must not exist (production / flag off). */
export function registerDevAuthDisabled(app: FastifyInstance): void {
  const disabled = async (_request: unknown, reply: FastifyReply) => {
    return reply.code(404).send({
      error: "NOT_FOUND",
      message: "dev auth is disabled",
    });
  };
  app.post("/dev/auth", disabled);
  app.post("/dev/referrals/attribute", disabled);
  app.post("/dev/referrals/:userId/activate-kick", disabled);
  app.post("/dev/referrals/qa-seed", disabled);
  app.post("/dev/tasks/evidence", disabled);
  app.post("/dev/kick/link", disabled);
  app.post("/dev/kick/stream/start", disabled);
  app.post("/dev/kick/stream/end", disabled);
  app.post("/dev/kick/chat/messages", disabled);
  app.post("/dev/giveaways/:id/draw-now", disabled);
  app.post("/dev/achievements/evaluate", disabled);
}
