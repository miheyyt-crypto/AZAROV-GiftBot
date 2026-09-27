import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { loadDatabaseUrl } from "@giftbot/config";
import { createDb, runMigrations } from "@giftbot/db";
import {
  adminRoleAssignments,
  adminRoles,
  freeCaseUserState,
  gramBalances,
  inventoryItems,
  kickAccounts,
  notifications,
  products,
  promoCodes,
  promoRedemptions,
  purchases,
  referralCaseEntitlements,
  referralCodes,
  referrals,
  submissionFiles,
  telegramAccounts,
  userKickStats,
  userLevelRewards,
  userProgress,
  userStreamStreaks,
  userTaskCompletions,
  userTaskEvidence,
  users,
  v1ImportIdentities,
  v1ImportRuns,
  wallets,
  welvuraAccountSubmissions,
  welvuraDepositSubmissions,
  welvuraLinks,
  welvuraStageCompletions,
} from "@giftbot/db/schema";
import {
  MAX_LEVEL,
  encryptSecret,
  getTask,
  parseTokenEncryptionKey,
} from "@giftbot/domain";
import { eq } from "drizzle-orm";
import { auditV1Store, type AuditInput } from "./audit.js";
import { gramMinorFromUnknown } from "./gram.js";
import {
  CORE_TASK_MAP,
  LIVE_SHOP_PRODUCT_MAP,
  PURCHASE_STATUS_MAP,
  V1_FREE_CASE_COOLDOWN_MS,
  V1_REFERRAL_CASE_EVERY,
  V1_WELVURA_DEPOSIT_LADDER,
  canonicalActivatedReferralCount,
  computeV1Xp,
  dragonmoneyTaskStage,
  getManualReferralCreditAmount,
  v1LevelRewardAzc,
  type V1CoreTaskId,
} from "./mappings.js";
import {
  asAzc,
  asMap,
  asNonNegInt,
  parseIso,
  telegramIdOf,
} from "./parse-store.js";
import type { CutoverReport } from "./report.js";
import { auditUploadFile, plannedStorageKey, resolveInsideRoot } from "./uploads.js";

function hashCanonicalReport(report: CutoverReport): string {
  const copy = { ...report, source: { ...report.source, readAt: "" } };
  return createHash("sha256").update(JSON.stringify(copy)).digest("hex");
}

function looksLikeQaUrl(url: string): boolean {
  return /localhost|127\.0\.0\.1|:55432|:55433|:5545|:5432\/giftbot/i.test(url);
}

export type ApplyFlags = {
  apply: boolean;
  confirmApply: boolean;
  confirmSourceSha256: string;
  confirmReportSha256: string;
  productionConfirm: boolean;
  databaseUrl?: string;
  kickTokenEncryptionKey?: string;
  uploadDir?: string;
};

export async function applyV1Cutover(input: {
  audit: AuditInput;
  flags: ApplyFlags;
}): Promise<{ report: CutoverReport; applied: boolean }> {
  const report = await auditV1Store(input.audit);
  if (!input.flags.apply || !input.flags.confirmApply) {
    throw new Error("apply requires --apply and --confirm-apply");
  }
  if (input.flags.confirmSourceSha256 !== input.audit.store.sha256) {
    throw new Error("source SHA256 confirmation does not match store");
  }
  const reportSha = hashCanonicalReport(report);
  if (input.flags.confirmReportSha256 !== reportSha) {
    throw new Error("dry-run report SHA256 confirmation does not match");
  }
  if (report.blockingIssues.length > 0) {
    throw new Error("refusing apply: blockingIssues is not empty");
  }
  const databaseUrl = input.flags.databaseUrl ?? loadDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for apply");
  }
  if (input.flags.productionConfirm && looksLikeQaUrl(databaseUrl)) {
    throw new Error("refusing production-confirm apply against QA/local DATABASE_URL");
  }

  await runMigrations(databaseUrl);
  const handle = createDb(databaseUrl);
  try {
    await handle.db.transaction(async (tx) => {
      const existing = await tx.select().from(v1ImportIdentities).limit(1);
      if (existing[0]) {
        const runs = await tx
          .select()
          .from(v1ImportRuns)
          .where(eq(v1ImportRuns.sourceSha256, input.audit.store.sha256))
          .limit(1);
        if (runs[0]?.mode === "cutover") {
          return;
        }
        throw new Error("database already has V1 import identities; refuse unsafe rerun");
      }

      const [run] = await tx
        .insert(v1ImportRuns)
        .values({
          mode: "cutover",
          dryRun: false,
          sourceSha256: input.audit.store.sha256,
          usersRead: Object.keys(input.audit.store.users).length,
          usersImported: 0,
          usersSkipped: 0,
          usersConflicted: 0,
          reconcileOk: true,
          report: { process: "v1-cutover" },
        })
        .returning();
      if (!run) {
        throw new Error("failed to insert cutover run");
      }

      const userIdByTg = new Map<string, string>();
      const encKey = input.flags.kickTokenEncryptionKey
        ? parseTokenEncryptionKey(input.flags.kickTokenEncryptionKey)
        : undefined;

      for (const user of Object.values(input.audit.store.users)) {
        const tg = telegramIdOf(user);
        if (!tg) {
          continue;
        }
        const createdAt = parseIso(user.createdAt) ?? new Date();
        const publicId = randomUUID();
        const [row] = await tx
          .insert(users)
          .values({
            publicId,
            displayName:
              typeof user.firstName === "string" && user.firstName
                ? user.firstName
                : null,
            locale:
              typeof user.languageCode === "string" ? user.languageCode : null,
            status: user.blocked === true ? "blocked" : "active",
            createdAt,
            updatedAt: createdAt,
          })
          .returning();
        if (!row) {
          throw new Error("user insert failed");
        }
        userIdByTg.set(tg.toString(), row.id);
        const bal = asAzc(user.balance) ?? 0n;
        await tx.insert(wallets).values({
          userId: row.id,
          balanceMinor: bal,
          openingBalanceMinor: bal,
          createdAt,
          updatedAt: createdAt,
        });
        await tx.insert(telegramAccounts).values({
          userId: row.id,
          telegramUserId: tg,
          username: typeof user.username === "string" ? user.username : null,
          firstName: typeof user.firstName === "string" ? user.firstName : null,
          lastName: typeof user.lastName === "string" ? user.lastName : null,
          languageCode:
            typeof user.languageCode === "string" ? user.languageCode : null,
          isPremium: user.isPremium === true,
          linkedAt: createdAt,
          isActive: true,
        });
        const code =
          typeof user.referralCode === "string" && user.referralCode.trim()
            ? user.referralCode.trim()
            : randomUUID().replace(/-/g, "").slice(0, 16);
        await tx.insert(referralCodes).values({
          userId: row.id,
          code,
          createdAt,
        });
        const gram = gramMinorFromUnknown(user.gramBalance);
        if (gram.ok && gram.minor > 0n) {
          await tx.insert(gramBalances).values({
            userId: row.id,
            amountMinor: gram.minor,
            reservedMinor: 0n,
          });
        }
        const chat = asNonNegInt(user.chatMessages) ?? 0;
        await tx.insert(userKickStats).values({
          userId: row.id,
          chatMessagesCounted: BigInt(chat),
        });
        const stats = input.audit.store.kickWatchStats[tg.toString()];
        const watch = asNonNegInt(stats?.watchSeconds ?? stats?.seconds) ?? 0;
        await tx.insert(userProgress).values({
          userId: row.id,
          totalXp: computeV1Xp(chat, watch),
        });
        await tx.insert(v1ImportIdentities).values({
          telegramUserId: tg,
          userId: row.id,
          mode: "cutover",
          importedBalanceMinor: bal,
          sourceLegacyId: tg.toString(),
          importRunId: run.id,
        });

        const claimed = Array.isArray(user.claimedLevelRewards)
          ? user.claimedLevelRewards
          : [];
        for (const raw of claimed) {
          const level = asNonNegInt(raw) ?? 0;
          if (level < 2 || level > MAX_LEVEL) {
            continue;
          }
          await tx.insert(userLevelRewards).values({
            userId: row.id,
            reachedLevel: level,
            rewardAzc: v1LevelRewardAzc(level),
            rewardTransactionId: null,
          });
        }

        const completed = Array.isArray(user.completedTasks)
          ? user.completedTasks
          : [];
        let botStarted: Date | undefined;
        let channelAt: Date | undefined;
        let followAt: Date | undefined;
        for (const raw of completed) {
          const v1code = String(raw);
          if (!(v1code in CORE_TASK_MAP)) {
            continue;
          }
          const v2 = CORE_TASK_MAP[v1code as V1CoreTaskId];
          const when = createdAt;
          await tx.insert(userTaskCompletions).values({
            userId: row.id,
            taskCode: v2,
            rewardAzc: getTask(v2).rewardAzc,
            verificationSnapshot: { v1TaskId: v1code, cutover: true },
            rewardTransactionId: null,
            completedAt: when,
          });
          if (v2 === "telegram_bot_started") {
            botStarted = when;
          }
          if (v2 === "telegram_subscribe_azarov222") {
            channelAt = when;
          }
          if (v2 === "kick_follow_azarov7777") {
            followAt = when;
          }
        }
        if (botStarted || channelAt || followAt) {
          await tx.insert(userTaskEvidence).values({
            userId: row.id,
            botStartedAt: botStarted,
            telegramChannelMemberAt: channelAt,
            kickFollowAzarovAt: followAt,
          });
        }
      }

      for (const user of Object.values(input.audit.store.users)) {
        const tg = telegramIdOf(user);
        const uid = tg ? userIdByTg.get(tg.toString()) : undefined;
        const lastFree = parseIso(user.lastDailyFreeCaseAt);
        if (!uid || !lastFree) {
          continue;
        }
        await tx.insert(freeCaseUserState).values({
          userId: uid,
          nextAvailableAt: new Date(lastFree.getTime() + V1_FREE_CASE_COOLDOWN_MS),
        });
      }

      for (const row of Object.values(input.audit.store.referrals)) {
        const referrer = String(row.referrerUserId ?? "");
        const referred = String(row.referredUserId ?? "");
        const a = userIdByTg.get(referrer);
        const b = userIdByTg.get(referred);
        if (!a || !b) {
          continue;
        }
        const status = String(row.status ?? "");
        const v2Status = status === "rewarded" ? "activated" : "attributed";
        const attributedAt = parseIso(row.createdAt) ?? new Date();
        const activatedAt =
          v2Status === "activated"
            ? parseIso(row.activatedAt) ?? parseIso(row.rewardedAt) ?? attributedAt
            : null;
        const refUser = input.audit.store.users[referrer];
        const code =
          typeof refUser?.referralCode === "string" ? refUser.referralCode : "unknown";
        await tx.insert(referrals).values({
          referrerUserId: a,
          refereeUserId: b,
          referralCodeUsed: code,
          status: v2Status,
          attributedAt,
          activatedAt,
        });
      }

      const activatedByReferrer = new Map<string, number>();
      for (const row of Object.values(input.audit.store.referrals)) {
        if (String(row.status) !== "rewarded") {
          continue;
        }
        const referrer = String(row.referrerUserId ?? "");
        activatedByReferrer.set(referrer, (activatedByReferrer.get(referrer) ?? 0) + 1);
      }
      const manualCredits = asMap(input.audit.store.raw.manualReferralCredits);
      for (const [tg, v1user] of Object.entries(input.audit.store.users)) {
        const uid = userIdByTg.get(tg);
        if (!uid) {
          continue;
        }
        const derived = activatedByReferrer.get(tg) ?? 0;
        const manual = getManualReferralCreditAmount(manualCredits, tg);
        const canonical = canonicalActivatedReferralCount(derived, manual);
        const earned = Math.floor(canonical / V1_REFERRAL_CASE_EVERY);
        const opened = asNonNegInt(v1user.openedReferralCases) ?? 0;
        for (let n = 1; n <= earned; n += 1) {
          await tx.insert(referralCaseEntitlements).values({
            userId: uid,
            milestoneNumber: n,
            referralCountThreshold: n * V1_REFERRAL_CASE_EVERY,
            consumedAt: n <= opened ? new Date() : null,
          });
        }
      }

      if (encKey) {
        for (const account of Object.values(input.audit.store.kickAccounts)) {
          const tg = String(account.telegramUserId ?? "");
          const uid = userIdByTg.get(tg);
          const kickUserId = String(account.kickUserId ?? account.kick_user_id ?? "");
          if (!uid || !kickUserId) {
            continue;
          }
          const access =
            typeof account.accessToken === "string" ? account.accessToken : "";
          const refresh =
            typeof account.refreshToken === "string" ? account.refreshToken : "";
          await tx.insert(kickAccounts).values({
            userId: uid,
            kickUserId,
            accessTokenEncrypted: access ? encryptSecret(encKey, access) : null,
            refreshTokenEncrypted: refresh ? encryptSecret(encKey, refresh) : null,
            scope: typeof account.tokenScope === "string" ? account.tokenScope : null,
            tokenExpiresAt: parseIso(account.tokenExpiresAt) ?? null,
            status: "active",
            linkedAt: parseIso(account.createdAt) ?? new Date(),
            username: typeof account.username === "string" ? account.username : null,
          });
        }
      }

      for (const row of Object.values(input.audit.store.kickStreamStreaks)) {
        const tg = String(row.telegramId ?? "");
        const uid = userIdByTg.get(tg);
        const current = asNonNegInt(row.currentStreak) ?? 0;
        if (!uid) {
          continue;
        }
        await tx.insert(userStreamStreaks).values({
          userId: uid,
          currentStreak: current,
          lastQualifiedStreamId: null,
          lastFinalizedStreamId: null,
        });
      }

      for (const item of Object.values(input.audit.store.inventory)) {
        const tg = String(item.userId ?? item.telegramUserId ?? "");
        const uid = userIdByTg.get(tg);
        if (!uid) {
          continue;
        }
        if (String(item.type ?? item.itemType) !== "streak-freeze") {
          continue;
        }
        await tx.insert(inventoryItems).values({
          userId: uid,
          itemType: "streak_freeze",
          status: String(item.status) === "consumed" ? "consumed" : "available",
          quantity: asNonNegInt(item.quantity) ?? 1,
          source: typeof item.sourceOrderId === "string" ? item.sourceOrderId : "v1",
          itemCode: "streak-freeze",
          title: "Streak Freeze",
          createdAt: parseIso(item.createdAt) ?? new Date(),
        });
      }

      const productRows = await tx.select().from(products);
      const productBySlug = new Map(productRows.map((p) => [p.slug, p]));
      for (const order of Object.values(input.audit.store.orders)) {
        const tg = String(order.userId ?? "");
        const uid = userIdByTg.get(tg);
        const v1pid = String(order.productId ?? "");
        const mapped = LIVE_SHOP_PRODUCT_MAP[v1pid];
        if (!uid || !mapped) {
          continue;
        }
        let product = productBySlug.get(mapped.v2Code);
        if (!product && mapped.catalog === "legacy_inactive") {
          const [created] = await tx
            .insert(products)
            .values({
              slug: mapped.v2Code,
              type: "legacy",
              priceMinor: asAzc(order.price) ?? 0n,
              status: "disabled",
            })
            .returning();
          if (created) {
            product = created;
            productBySlug.set(mapped.v2Code, created);
          }
        }
        if (!product) {
          continue;
        }
        const v2status = PURCHASE_STATUS_MAP[String(order.status)] ?? "failed";
        await tx.insert(purchases).values({
          userId: uid,
          productId: product.id,
          status: v2status,
          priceMinor: asAzc(order.price) ?? 0n,
          idempotencyKey: `v1-cutover:order:${String(order.orderId ?? order.id)}`,
          productCode: mapped.v2Code,
          productNameSnapshot:
            typeof order.productName === "string" ? order.productName : mapped.v2Code,
          submittedPayload:
            order.metadata && typeof order.metadata === "object"
              ? (order.metadata as Record<string, unknown>)
              : {},
          createdAt: parseIso(order.createdAt) ?? new Date(),
          fulfilledAt: parseIso(order.completedAt) ?? null,
          rejectedAt: parseIso(order.rejectedAt) ?? null,
          rejectionReason:
            typeof order.rejectionReason === "string" ? order.rejectionReason : null,
          processingAt: parseIso(order.processingAt) ?? null,
        });
      }

      for (const promo of Object.values(input.audit.store.promoCodes)) {
        const code = String(promo.code ?? "");
        if (!code) {
          continue;
        }
        const [inserted] = await tx
          .insert(promoCodes)
          .values({
            code,
            normalizedCode: code.trim().toUpperCase(),
            rewardAzc: asAzc(promo.reward) ?? 1n,
            activationLimit: Math.max(1, asNonNegInt(promo.maxUses) ?? 1),
            activationCount: asNonNegInt(promo.usedCount) ?? 0,
            status: promo.active === false ? "inactive" : "active",
            createdAt: parseIso(promo.createdAt) ?? new Date(),
            deactivatedAt: parseIso(promo.deactivatedAt) ?? null,
          })
          .returning();
        if (!inserted) {
          continue;
        }
        for (const usage of Object.values(input.audit.store.promoUsages)) {
          if (String(usage.code) !== code) {
            continue;
          }
          const uid = userIdByTg.get(String(usage.userId ?? ""));
          if (!uid) {
            continue;
          }
          await tx.insert(promoRedemptions).values({
            promoCodeId: inserted.id,
            userId: uid,
            rewardAzc: asAzc(usage.reward) ?? inserted.rewardAzc,
            idempotencyKey: `v1-cutover:promo:${code}:${String(usage.userId)}`,
            createdAt: parseIso(usage.usedAt) ?? new Date(),
          });
        }
      }

      for (const note of Object.values(input.audit.store.notifications)) {
        const uid = userIdByTg.get(String(note.userId ?? ""));
        if (!uid) {
          continue;
        }
        await tx.insert(notifications).values({
          userId: uid,
          channel: "inbox",
          type: typeof note.type === "string" ? note.type : "legacy",
          status: "sent",
          payload:
            note.metadata && typeof note.metadata === "object"
              ? (note.metadata as Record<string, unknown>)
              : {},
          title: typeof note.title === "string" ? note.title : null,
          body: typeof note.message === "string" ? note.message : null,
          createdAt: parseIso(note.createdAt) ?? new Date(),
          sentAt: parseIso(note.createdAt) ?? new Date(),
          readAt: note.read === true ? parseIso(note.createdAt) ?? new Date() : null,
        });
      }

      if (input.audit.uploadsRoot && input.flags.uploadDir) {
        const destRoot = input.flags.uploadDir;
        for (const sub of Object.values(input.audit.store.partnerSubmissions)) {
          const status = String(sub.status ?? "");
          const shot = typeof sub.screenshotPath === "string" ? sub.screenshotPath : "";
          const mapped = dragonmoneyTaskStage(String(sub.taskId ?? ""));
          const tg = String(sub.telegramUserId ?? "");
          const uid = userIdByTg.get(tg);
          if (!uid || !mapped || (status !== "pending" && status !== "approved")) {
            continue;
          }
          const file = await auditUploadFile(input.audit.uploadsRoot, shot);
          if (!file.exists || !file.sha256 || !file.contentType) {
            continue;
          }
          const ext =
            file.contentType === "image/png"
              ? "png"
              : file.contentType === "image/webp"
                ? "webp"
                : "jpg";
          const key = plannedStorageKey("welvura", file.sha256, ext);
          const src = resolveInsideRoot(input.audit.uploadsRoot, shot);
          if (!src) {
            continue;
          }
          const dest = `${destRoot.replace(/\\/g, "/")}/${key}`;
          await mkdir(dirname(dest), { recursive: true });
          await copyFile(src, dest);
          const [sf] = await tx
            .insert(submissionFiles)
            .values({
              storageKey: key,
              contentType: file.contentType,
              byteSize: file.byteSize ?? 0,
              createdByUserId: uid,
            })
            .returning();
          if (!sf) {
            continue;
          }
          const welvuraId = String(sub.partnerAccountId ?? "");
          if (mapped.kind === "account_link") {
            await tx.insert(welvuraAccountSubmissions).values({
              userId: uid,
              attemptNumber: asNonNegInt(sub.attemptNumber) ?? 1,
              welvuraExternalId: welvuraId,
              screenshotFileId: sf.id,
              status,
              submittedAt: parseIso(sub.createdAt) ?? new Date(),
              moderatedAt: parseIso(sub.reviewedAt) ?? null,
              rejectionReason:
                typeof sub.rejectionReason === "string" ? sub.rejectionReason : null,
            });
            if (status === "approved") {
              await tx.insert(welvuraLinks).values({
                userId: uid,
                welvuraExternalId: welvuraId,
                status: "approved",
              });
            }
          } else if (mapped.stageNumber) {
            const stage = mapped.stageNumber;
            const ladder = V1_WELVURA_DEPOSIT_LADDER.find((s) => s.stageNumber === stage);
            const [dep] = await tx
              .insert(welvuraDepositSubmissions)
              .values({
                userId: uid,
                stageNumber: stage,
                attemptNumber: 1,
                welvuraExternalId: welvuraId,
                requiredDepositRub: ladder?.requiredDepositRub ?? 0n,
                rewardAzc: asAzc(sub.reward) ?? ladder?.rewardAzc ?? 0n,
                screenshotFileId: sf.id,
                status,
                submittedAt: parseIso(sub.createdAt) ?? new Date(),
              })
              .returning();
            if (dep && status === "approved") {
              await tx.insert(welvuraStageCompletions).values({
                userId: uid,
                stageNumber: stage,
                submissionId: dep.id,
                rewardAzc: asAzc(sub.reward) ?? 0n,
                rewardTransactionId: null,
              });
            }
          }
        }
      }

      if (input.audit.adminTelegramIds) {
        const roles = await tx
          .select()
          .from(adminRoles)
          .where(eq(adminRoles.name, "super_admin"))
          .limit(1);
        const role = roles[0];
        if (role) {
          for (const id of input.audit.adminTelegramIds) {
            const uid = userIdByTg.get(id.toString());
            if (!uid) {
              continue;
            }
            await tx.insert(adminRoleAssignments).values({
              userId: uid,
              roleId: role.id,
            });
          }
        }
      }
    });
  } finally {
    await handle.sql.end({ timeout: 5 });
  }

  return { report: { ...report, mode: "apply" }, applied: true };
}

export { hashCanonicalReport };
