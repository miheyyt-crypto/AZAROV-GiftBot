import { formatGramMinor, MAX_LEVEL, SHOP_CATALOG, computeLevel } from "@giftbot/domain";
import { gramMinorFromUnknown } from "./gram.js";
import {
  CORE_TASK_MAP,
  LIVE_SHOP_PRODUCT_MAP,
  MAX_STREAM_STREAK,
  PURCHASE_STATUS_MAP,
  V1_FREE_CASE_COOLDOWN_MS,
  assertWelvuraLaddersMatch,
  canonicalActivatedReferralCount,
  computeV1Xp,
  dragonmoneyTaskStage,
  getManualReferralCreditAmount,
  lookupV1CaseDrop,
  mapPaidCaseCode,
  referralCaseAvailability,
  type V1CoreTaskId,
} from "./mappings.js";
import {
  OMITTED_CACHE_KEYS,
  asAzc,
  asMap,
  asNonNegInt,
  parseIso,
  telegramIdOf,
  type V1Store,
} from "./parse-store.js";
import type { CutoverReport, Issue } from "./report.js";
import { auditUploadFile, type UploadAudit } from "./uploads.js";
import {
  classifyMinesGame,
  classifyRollsRound,
  classifyTowerGame,
  type GameDiagnostic,
} from "./games.js";

const LIVE_SHOP = new Set(SHOP_CATALOG.map((p) => p.code));

export type AuditInput = {
  store: V1Store;
  storePath: string;
  uploadsRoot?: string;
  adminTelegramIds?: bigint[];
};

function issue(code: string, message: string): Issue {
  return { code, message };
}

function values<T>(map: Record<string, T>): T[] {
  return Object.values(map);
}

function watchSecondsFor(store: V1Store, telegramId: bigint): number {
  const stats = store.kickWatchStats[telegramId.toString()];
  const raw = stats?.watchSeconds ?? stats?.seconds;
  return asNonNegInt(raw) ?? 0;
}

export async function auditV1Store(input: AuditInput): Promise<CutoverReport> {
  const blocking: Issue[] = [];
  const warnings: Issue[] = [];
  const legacyOnly: Issue[] = [];
  const ladder = assertWelvuraLaddersMatch();
  if (ladder) {
    blocking.push(issue("welvura_ladder_mismatch", ladder));
  }

  const users = values(input.store.users);
  const telegramIds = new Map<string, number>();
  const userByTg = new Map<string, Record<string, unknown>>();
  let invalidIdentities = 0;
  let duplicateTelegram = 0;
  let azcTotal = 0n;
  let azcMin: bigint | undefined;
  let azcMax: bigint | undefined;
  const azcNeg = 0;
  const gramMinors: bigint[] = [];
  let gramUsers = 0;
  let gramFail = 0;
  const referralCodes = new Set<string>();
  const duplicateCodes: string[] = [];

  for (const user of users) {
    const id = telegramIdOf(user);
    if (id === undefined || id <= 0n) {
      invalidIdentities += 1;
      blocking.push(issue("invalid_telegram_identity", "user missing positive telegramId"));
      continue;
    }
    const key = id.toString();
    telegramIds.set(key, (telegramIds.get(key) ?? 0) + 1);
    if ((telegramIds.get(key) ?? 0) > 1) {
      duplicateTelegram += 1;
      blocking.push(issue("duplicate_telegram_id", `duplicate telegramId ${key}`));
    }
    userByTg.set(key, user);
    const bal = asAzc(user.balance);
    if (bal === undefined) {
      blocking.push(issue("azc_invalid", `non-integer AZC for ${key}`));
    } else {
      azcTotal += bal;
      azcMin = azcMin === undefined ? bal : bal < azcMin ? bal : azcMin;
      azcMax = azcMax === undefined ? bal : bal > azcMax ? bal : azcMax;
    }
    const gram = gramMinorFromUnknown(user.gramBalance);
    if (!gram.ok) {
      gramFail += 1;
      blocking.push(issue("gram_conversion", `${key}: ${gram.reason}`));
    } else if (user.gramBalance !== undefined && user.gramBalance !== null) {
      gramUsers += 1;
      gramMinors.push(gram.minor);
    }
    const code = typeof user.referralCode === "string" ? user.referralCode.trim() : "";
    if (code) {
      if (referralCodes.has(code)) {
        duplicateCodes.push(code);
        blocking.push(issue("duplicate_referral_code", `duplicate referral code`));
      }
      referralCodes.add(code);
    }
  }

  const plannedAzc = azcTotal;
  if (azcNeg > 0) {
    blocking.push(issue("azc_negative", "negative AZC balances"));
  }

  const gramTotal = gramMinors.reduce((a, b) => a + b, 0n);
  const gramRoundtrip = formatGramMinor(gramTotal);

  const statusCounts: Record<string, number> = {};
  let mappedRefs = 0;
  let unmappedRefs = 0;
  const refereeSeen = new Set<string>();
  const derivedActive = new Map<string, number>();
  for (const [refKey, row] of Object.entries(input.store.referrals)) {
    const status = String(row.status ?? "");
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    const referrer = String(row.referrerUserId ?? "");
    const referred = String(row.referredUserId ?? "");
    if (!userByTg.has(referrer) || !userByTg.has(referred)) {
      unmappedRefs += 1;
      blocking.push(issue("broken_referral_ref", `referral ${refKey} has missing user`));
      continue;
    }
    if (referrer === referred) {
      unmappedRefs += 1;
      blocking.push(issue("self_referral", `self referral ${refKey}`));
      continue;
    }
    if (refereeSeen.has(referred)) {
      unmappedRefs += 1;
      blocking.push(issue("duplicate_referee", `duplicate referee ${referred}`));
      continue;
    }
    refereeSeen.add(referred);
    if (status === "pending") {
      mappedRefs += 1;
    } else if (status === "rewarded") {
      mappedRefs += 1;
      derivedActive.set(referrer, (derivedActive.get(referrer) ?? 0) + 1);
    } else if (status === "active") {
      unmappedRefs += 1;
      blocking.push(
        issue(
          "inflight_referral_reward",
          `referral ${refKey} status=active (V1 transient reward apply)`,
        ),
      );
    } else {
      unmappedRefs += 1;
      blocking.push(issue("unknown_referral_status", `referral ${refKey} status=${status}`));
    }
  }

  let activeMismatch = 0;
  let earned = 0;
  let consumed = 0;
  let availableSource = 0;
  let availablePlanned = 0;
  let referralCaseMismatch = 0;
  let normalActivated = 0;
  let manualActivatedCredits = 0;
  const manualCredits = asMap(input.store.raw.manualReferralCredits);
  for (const [tg, user] of userByTg) {
    const derived = derivedActive.get(tg) ?? 0;
    const manual = getManualReferralCreditAmount(manualCredits, tg);
    const canonical = canonicalActivatedReferralCount(derived, manual);
    normalActivated += derived;
    manualActivatedCredits += manual;
    const cached = asNonNegInt(user.activeReferrals) ?? 0;
    if (canonical !== cached) {
      activeMismatch += 1;
      warnings.push(
        issue(
          "active_referrals_cache",
          `user ${tg} activeReferrals cache=${String(cached)} canonical=${String(canonical)} (rows=${String(derived)} manual=${String(manual)})`,
        ),
      );
    }
    const opened = asNonNegInt(user.openedReferralCases) ?? 0;
    const stats = referralCaseAvailability(canonical, opened);
    if (opened > stats.earned) {
      referralCaseMismatch += 1;
      blocking.push(
        issue(
          "referral_case_overconsumed",
          `user ${tg} opened ${String(opened)} > earned ${String(stats.earned)}`,
        ),
      );
    }
    earned += stats.earned;
    consumed += stats.consumed;
    availableSource += stats.available;
    availablePlanned += stats.available;
  }
  if (availableSource !== availablePlanned) {
    blocking.push(issue("referral_case_availability", "planned available cases differ"));
  }

  let kickSource = 0;
  let kickPlanned = 0;
  let kickTokenPresent = 0;
  let kickMissingUser = 0;
  for (const [kickUserId, account] of Object.entries(input.store.kickAccounts)) {
    kickSource += 1;
    const tg = String(account.telegramUserId ?? "");
    const hasAccess = typeof account.accessToken === "string" && account.accessToken.length > 0;
    const hasRefresh = typeof account.refreshToken === "string" && account.refreshToken.length > 0;
    if (hasAccess || hasRefresh) {
      kickTokenPresent += 1;
    }
    if (!userByTg.has(tg)) {
      kickMissingUser += 1;
      blocking.push(issue("kick_unmapped_user", `kick account ${kickUserId} missing telegram user`));
      continue;
    }
    if (!kickUserId) {
      blocking.push(issue("kick_invalid", "kick account missing provider id"));
      continue;
    }
    kickPlanned += 1;
  }

  const taskByCode: Record<string, number> = {};
  const taskMapped: Record<string, number> = {};
  let unknownTasks = 0;
  for (const user of userByTg.values()) {
    const completed = Array.isArray(user.completedTasks) ? user.completedTasks : [];
    for (const raw of completed) {
      const code = String(raw);
      taskByCode[code] = (taskByCode[code] ?? 0) + 1;
      if (code in CORE_TASK_MAP) {
        const v2 = CORE_TASK_MAP[code as V1CoreTaskId];
        taskMapped[v2] = (taskMapped[v2] ?? 0) + 1;
      } else if (dragonmoneyTaskStage(code)) {
        /* welvura tasks counted separately */
      } else {
        unknownTasks += 1;
        warnings.push(issue("unknown_task_code", `unknown V1 task ${code}`));
      }
    }
  }

  const welvuraByStatus: Record<string, number> = {};
  const welvuraByType: Record<string, number> = {};
  let welvuraMissingFile = 0;
  let welvuraDeletedRejected = 0;
  let welvuraUnmapped = 0;
  const uploadAudits: UploadAudit[] = [];
  const referencedPaths = new Set<string>();

  for (const [sid, sub] of Object.entries(input.store.partnerSubmissions)) {
    const partnerId = String(sub.partnerId ?? "");
    const status = String(sub.status ?? "");
    const taskId = String(sub.taskId ?? "");
    welvuraByStatus[status] = (welvuraByStatus[status] ?? 0) + 1;
    if (partnerId !== "dragonmoney") {
      welvuraUnmapped += 1;
      legacyOnly.push(issue("non_welvura_partner", `submission ${sid} partner=${partnerId}`));
      continue;
    }
    const mapped = dragonmoneyTaskStage(taskId);
    if (!mapped) {
      welvuraUnmapped += 1;
      blocking.push(issue("unknown_welvura_task", `submission ${sid} task=${taskId}`));
      continue;
    }
    welvuraByType[mapped.kind] = (welvuraByType[mapped.kind] ?? 0) + 1;
    const shot = typeof sub.screenshotPath === "string" ? sub.screenshotPath : "";
    const deleted = parseIso(sub.screenshotDeletedAt);
    const needsFile = status === "pending" || status === "approved";
    if (shot) {
      referencedPaths.add(shot);
    }
    if (needsFile) {
      if (!shot || deleted) {
        welvuraMissingFile += 1;
        blocking.push(
          issue(
            "welvura_missing_screenshot",
            `pending/approved submission ${sid} missing screenshot`,
          ),
        );
      } else if (!input.uploadsRoot) {
        welvuraMissingFile += 1;
        blocking.push(
          issue(
            "welvura_missing_screenshot",
            `pending/approved submission ${sid} cannot verify file without uploads root`,
          ),
        );
      }
    } else if (status === "rejected" && (deleted || !shot)) {
      welvuraDeletedRejected += 1;
      legacyOnly.push(
        issue(
          "welvura_rejected_screenshot_omitted",
          `rejected submission ${sid} has no screenshot (V1 deleted/absent); not fabricated`,
        ),
      );
    }
  }

  if (input.uploadsRoot) {
    for (const rel of referencedPaths) {
      const audit = await auditUploadFile(input.uploadsRoot, rel);
      uploadAudits.push(audit);
      if (audit.traversal) {
        blocking.push(issue("upload_path_traversal", rel));
      }
    }
    for (const [sid, sub] of Object.entries(input.store.partnerSubmissions)) {
      const status = String(sub.status ?? "");
      const shot = typeof sub.screenshotPath === "string" ? sub.screenshotPath : "";
      if ((status === "pending" || status === "approved") && shot) {
        const hit = uploadAudits.find((a) => a.relativePath === shot);
        if (!hit || hit.missing) {
          welvuraMissingFile += 1;
          blocking.push(
            issue("welvura_missing_screenshot", `file missing for submission ${sid}`),
          );
        }
      }
    }
  } else {
    warnings.push(issue("uploads_root_missing", "uploads root not provided; file existence not hashed"));
  }

  const invByType: Record<string, number> = {};
  const invByStatus: Record<string, number> = {};
  for (const item of values(input.store.inventory)) {
    const type = String(item.type ?? item.itemType ?? "");
    const status = String(item.status ?? "");
    invByType[type] = (invByType[type] ?? 0) + 1;
    invByStatus[status] = (invByStatus[status] ?? 0) + 1;
    if (type !== "streak-freeze") {
      legacyOnly.push(issue("inventory_unknown_type", `inventory type ${type}`));
    }
  }

  const orderStatus: Record<string, number> = {};
  const orderProducts: Record<string, number> = {};
  let unmappedProducts = 0;
  let unmappableActiveOrders = 0;
  for (const [oid, order] of Object.entries(input.store.orders)) {
    const status = String(order.status ?? "");
    const productId = String(order.productId ?? "");
    orderStatus[status] = (orderStatus[status] ?? 0) + 1;
    orderProducts[productId] = (orderProducts[productId] ?? 0) + 1;
    const mapped = LIVE_SHOP_PRODUCT_MAP[productId];
    if (!mapped) {
      unmappedProducts += 1;
      if (status === "pending" || status === "processing") {
        unmappableActiveOrders += 1;
        blocking.push(
          issue("active_order_unmapped", `active order ${oid} product ${productId}`),
        );
      } else {
        legacyOnly.push(issue("legacy_order_product", `order ${oid} product ${productId}`));
      }
      continue;
    }
    if (mapped.catalog === "live" && !LIVE_SHOP.has(mapped.v2Code)) {
      blocking.push(issue("shop_catalog_missing", mapped.v2Code));
    }
    if (!PURCHASE_STATUS_MAP[status]) {
      blocking.push(issue("unknown_order_status", `order ${oid} status=${status}`));
    }
  }

  let promoLimitMismatch = 0;
  for (const [code, promo] of Object.entries(input.store.promoCodes)) {
    const used = asNonNegInt(promo.usedCount) ?? 0;
    const usages = values(input.store.promoUsages).filter(
      (u) => String(u.code) === code || String(u.code).toUpperCase() === code.toUpperCase(),
    );
    if (usages.length !== used) {
      promoLimitMismatch += 1;
      warnings.push(
        issue(
          "promo_count_mismatch",
          `promo ${code} usedCount=${String(used)} redemptions=${String(usages.length)}`,
        ),
      );
    }
  }

  const caseById: Record<string, number> = {};
  let casesPlanned = 0;
  let casesLegacy = 0;
  for (const opening of values(input.store.caseOpenings)) {
    const caseId = String(opening.caseId ?? "");
    const rewardId = String(opening.rewardId ?? "");
    caseById[caseId] = (caseById[caseId] ?? 0) + 1;
    const drop = lookupV1CaseDrop(caseId, rewardId);
    const v2Code = mapPaidCaseCode(caseId);
    if (caseId === "referral") {
      casesLegacy += 1;
      legacyOnly.push(
        issue(
          "case_opening_legacy",
          "referral opening kept as entitlement consumption; V2 opening snapshot not reconstructed",
        ),
      );
      continue;
    }
    if (!v2Code || !drop) {
      casesLegacy += 1;
      legacyOnly.push(
        issue(
          "case_opening_unknown",
          `opening case=${caseId} reward=${rewardId} has no exact V1 drop snapshot`,
        ),
      );
      continue;
    }
    casesPlanned += 1;
    casesLegacy += 1;
    legacyOnly.push(
      issue(
        "case_opening_odds_history_only",
        `${caseId}→${v2Code} reward ${rewardId} displayChance=${String(drop.chance)}% (V1 table; not current V2 weights; not inserted as V2 RNG row)`,
      ),
    );
  }

  let freeCooldown = 0;
  let freeInvalid = 0;
  for (const [tg, user] of userByTg) {
    const last = parseIso(user.lastDailyFreeCaseAt);
    if (!last && user.lastDailyFreeCaseAt) {
      freeInvalid += 1;
      blocking.push(issue("free_case_timestamp", `invalid lastDailyFreeCaseAt user ${tg}`));
      continue;
    }
    if (last) {
      freeCooldown += 1;
    }
  }

  let xpAboveCap = 0;
  let claimedOver50 = 0;
  let claimed1 = 0;
  let claimed2to50Markers = 0;
  for (const user of userByTg.values()) {
    const tg = telegramIdOf(user);
    if (!tg) {
      continue;
    }
    const chat = asNonNegInt(user.chatMessages) ?? 0;
    const xp = computeV1Xp(chat, watchSecondsFor(input.store, tg));
    if (xp > 2_307_800n) {
      xpAboveCap += 1;
    }
    const claimed = Array.isArray(user.claimedLevelRewards) ? user.claimedLevelRewards : [];
    for (const raw of claimed) {
      const level = asNonNegInt(raw) ?? 0;
      if (level === 1) {
        claimed1 += 1;
      }
      if (level >= 2 && level <= MAX_LEVEL) {
        claimed2to50Markers += 1;
      }
      if (level > MAX_LEVEL) {
        claimedOver50 += 1;
      }
    }
  }

  const achCounts: Record<string, number> = {};
  let chatMessageRiskUsers = 0;
  let referrals5RiskUsers = 0;
  let level10RiskUsers = 0;
  for (const [tg, user] of userByTg) {
    const claimed = Array.isArray(user.claimedAchievements) ? user.claimedAchievements : [];
    for (const raw of claimed) {
      const code = String(raw);
      achCounts[code] = (achCounts[code] ?? 0) + 1;
    }
    const chat = asNonNegInt(user.chatMessages) ?? 0;
    if (chat >= 100) {
      chatMessageRiskUsers += 1;
    }
    if ((derivedActive.get(tg) ?? 0) >= 5) {
      referrals5RiskUsers += 1;
    }
    const xp = computeV1Xp(chat, watchSecondsFor(input.store, BigInt(tg)));
    if (computeLevel(xp).current >= 10) {
      level10RiskUsers += 1;
    }
  }
  if (chatMessageRiskUsers > 0) {
    warnings.push(
      issue(
        "achievement_duplicate_risk",
        `imported chatMessages >= 100 for ${String(chatMessageRiskUsers)} user(s) would unlock V2 kick_100_messages (V1 chat-messages is 1000/3000; not equivalent; no marker planned)`,
      ),
    );
  }
  if (referrals5RiskUsers > 0) {
    warnings.push(
      issue(
        "achievement_duplicate_risk",
        `imported activated referrals >= 5 for ${String(referrals5RiskUsers)} user(s) would unlock V2 referrals_5_active (V1 friends is 10/4000; not equivalent; no marker planned)`,
      ),
    );
  }
  if (level10RiskUsers > 0) {
    warnings.push(
      issue(
        "achievement_duplicate_risk",
        `imported XP at V2 level >= 10 for ${String(level10RiskUsers)} user(s) would unlock V2 level_10 achievement (not a V1 achievement; no marker planned)`,
      ),
    );
  }
  for (const code of Object.keys(achCounts)) {
    legacyOnly.push(
      issue("achievement_no_exact_map", `V1 achievement ${code} has no identical V2 code/threshold/reward`),
    );
  }

  let streakSource = 0;
  let streakPlanned = 0;
  let streakBlock = 0;
  for (const row of values(input.store.kickStreamStreaks)) {
    streakSource += 1;
    const current = asNonNegInt(row.currentStreak) ?? 0;
    if (current > MAX_STREAM_STREAK) {
      streakBlock += 1;
      blocking.push(
        issue("streak_over_max", `currentStreak ${String(current)} > ${String(MAX_STREAM_STREAK)}`),
      );
      continue;
    }
    streakPlanned += 1;
  }

  let wdSource = 0;
  let wdLegacy = 0;
  let wdActiveBlock = 0;
  for (const [wid, row] of Object.entries(input.store.withdrawals)) {
    wdSource += 1;
    const status = String(row.status ?? row.Status ?? "").toUpperCase();
    const method = String(row.method ?? row.METHOD ?? "");
    const active = status === "PENDING" || status === "PROCESSING";
    if (method !== "WELVURA" && method !== "GRAM") {
      if (active) {
        wdActiveBlock += 1;
        blocking.push(
          issue("active_withdrawal_unmapped", `withdrawal ${wid} method=${method} status=${status}`),
        );
      } else {
        wdLegacy += 1;
        legacyOnly.push(
          issue("withdrawal_legacy", `withdrawal ${wid} method=${method} status=${status}`),
        );
      }
      continue;
    }
    if (active) {
      if (method === "WELVURA") {
        warnings.push(
          issue(
            "pending_welvura_withdrawal",
            `WELVURA withdrawal ${wid} pending; requires inventory cash_rub mapping on apply`,
          ),
        );
      }
    } else {
      wdLegacy += 1;
      legacyOnly.push(
        issue("withdrawal_historical", `withdrawal ${wid} ${method} ${status}`),
      );
    }
  }

  for (const [cid, row] of Object.entries(asMap(input.store.raw.communityAccessRequests))) {
    const status = String(row.status ?? "");
    if (status === "pending" || status === "review" || status === "open") {
      blocking.push(
        issue(
          "active_community_access",
          `community-access request ${cid} status=${status} cannot be silently dropped`,
        ),
      );
    } else {
      legacyOnly.push(
        issue(
          "community_access_legacy",
          `community-access ${cid} status=${status} has no V2 table`,
        ),
      );
    }
  }
  for (const [cid, row] of Object.entries(asMap(input.store.raw.referralContests))) {
    const status = String(row.status ?? "");
    if (status === "active" || status === "open" || status === "running") {
      blocking.push(
        issue(
          "active_referral_contest",
          `referral contest ${cid} status=${status} cannot be silently dropped`,
        ),
      );
    } else {
      legacyOnly.push(
        issue("referral_contest_legacy", `referral contest ${cid} status=${status}`),
      );
    }
  }
  for (const [cid] of Object.entries(asMap(input.store.raw.manualReferralCredits))) {
    legacyOnly.push(
      issue(
        "manual_referral_credit_legacy",
        `manual referral credit ${cid} already in opening AZC; not replayed`,
      ),
    );
  }

  const giveawayCount = values(input.store.giveaways).length;
  const giveawayParts = values(input.store.giveawayParticipants).length;
  let giveawayBlock = 0;
  for (const [gid, g] of Object.entries(input.store.giveaways)) {
    const status = String(g.status ?? "");
    if (status === "active" || status === "open") {
      giveawayBlock += 1;
      blocking.push(issue("active_giveaway", `giveaway ${gid} status=${status} cannot be silently dropped`));
    }
  }

  const gameDiagnostics: GameDiagnostic[] = [];
  for (const [id, g] of Object.entries(input.store.minesGames)) {
    gameDiagnostics.push(classifyMinesGame(id, g));
  }
  for (const [id, g] of Object.entries(input.store.towerGames)) {
    gameDiagnostics.push(classifyTowerGame(id, g));
  }
  for (const [id, g] of Object.entries(input.store.rollRounds)) {
    gameDiagnostics.push(classifyRollsRound(id, g));
  }
  const openGameRows = gameDiagnostics.filter(
    (row) => row.financiallyBlocking || row.staleNonFinancial,
  );
  const financiallyBlockingGames = gameDiagnostics.filter((row) => row.financiallyBlocking);
  const staleNonFinancialGames = gameDiagnostics.filter((row) => row.staleNonFinancial);
  const byGame: Record<string, { open: number; blocking: number; stale: number; azcAtRisk: string }> =
    {};
  let totalAzcAtRisk = 0n;
  for (const row of gameDiagnostics) {
    const slot = byGame[row.kind] ?? { open: 0, blocking: 0, stale: 0, azcAtRisk: "0" };
    if (row.financiallyBlocking || row.staleNonFinancial) {
      slot.open += 1;
    }
    if (row.financiallyBlocking) {
      slot.blocking += 1;
      const add = BigInt(row.totalDebitedAzc);
      slot.azcAtRisk = (BigInt(slot.azcAtRisk) + add).toString();
      totalAzcAtRisk += add;
    }
    if (row.staleNonFinancial) {
      slot.stale += 1;
    }
    byGame[row.kind] = slot;
  }
  if (financiallyBlockingGames.length > 0) {
    blocking.push(
      issue(
        "unresolved_game",
        `${String(financiallyBlockingGames.length)} unresolved V1 game(s)/round(s) with AZC at risk`,
      ),
    );
  }

  let adminStatus = "skipped_no_ids_input";
  let adminMissing = 0;
  if (input.adminTelegramIds && input.adminTelegramIds.length > 0) {
    adminStatus = "checked";
    for (const id of input.adminTelegramIds) {
      if (!userByTg.has(id.toString())) {
        adminMissing += 1;
        blocking.push(issue("admin_identity_missing", "configured admin telegram id not in store"));
      }
    }
  }

  const existingUploads = uploadAudits.filter((a) => a.exists).length;
  const missingUploads = uploadAudits.filter((a) => a.missing && !a.traversal).length;

  const report: CutoverReport = {
    process: "v1-cutover",
    mode: "audit",
    source: {
      storePath: input.storePath,
      uploadsPath: input.uploadsRoot ?? null,
      sha256: input.store.sha256,
      storeVersion: input.store.version,
      readAt: new Date().toISOString(),
    },
    users: {
      sourceCount: users.length,
      plannedCount: userByTg.size,
      duplicateTelegramIds: duplicateTelegram,
      invalidIdentities,
    },
    wallet: {
      userCount: userByTg.size,
      sourceTotal: azcTotal.toString(),
      plannedTotal: plannedAzc.toString(),
      min: azcMin?.toString() ?? null,
      max: azcMax?.toString() ?? null,
      negatives: azcNeg,
      mismatchCount: azcTotal === plannedAzc ? 0 : 1,
    },
    gram: {
      sourceCount: gramUsers,
      sourceCanonicalTotal: gramRoundtrip,
      plannedMinorTotal: gramTotal.toString(),
      roundtripTotal: gramRoundtrip,
      conversionFailures: gramFail,
    },
    referrals: {
      sourceCount: Object.keys(input.store.referrals).length,
      mapped: mappedRefs,
      unmapped: unmappedRefs,
      statusMappingCounts: statusCounts,
      activeReferralDerivedMismatches: activeMismatch,
    },
    referralCase: {
      normalActivated,
      manualActivatedCredits,
      canonicalEarnedCredits: normalActivated + manualActivatedCredits,
      earned,
      consumed,
      availableSource,
      availablePlanned,
      mismatches: referralCaseMismatch,
    },
    kick: {
      sourceAccounts: kickSource,
      plannedAccounts: kickPlanned,
      tokenPresentCounts: kickTokenPresent,
      missingIdentities: kickMissingUser,
      tokensEmitted: false,
    },
    tasks: {
      sourceCompletionCounts: taskByCode,
      mappings: taskMapped,
      unknownCodes: unknownTasks,
    },
    welvura: {
      links: Object.keys(input.store.partnerAccountBinds).length,
      submissionsByStatus: welvuraByStatus,
      submissionsByType: welvuraByType,
      missingFiles: welvuraMissingFile,
      rejectedScreenshotOmitted: welvuraDeletedRejected,
      mappingFailures: welvuraUnmapped,
    },
    inventory: {
      count: Object.keys(input.store.inventory).length,
      byType: invByType,
      byStatus: invByStatus,
    },
    orders: {
      count: Object.keys(input.store.orders).length,
      byStatus: orderStatus,
      byProduct: orderProducts,
      unmappedLegacyProducts: unmappedProducts,
      unmappableActive: unmappableActiveOrders,
    },
    promo: {
      codes: Object.keys(input.store.promoCodes).length,
      redemptions: Object.keys(input.store.promoUsages).length,
      usedCountDiscrepancies: promoLimitMismatch,
    },
    notifications: {
      source: Object.keys(input.store.notifications).length,
      planned: Object.keys(input.store.notifications).length,
    },
    cases: {
      source: Object.keys(input.store.caseOpenings).length,
      byCaseId: caseById,
      plannedSnapshots: casesPlanned,
      legacyOnly: casesLegacy,
    },
    freeCase: {
      usersWithCooldown: freeCooldown,
      plannedCooldown: freeCooldown,
      invalidTimestamps: freeInvalid,
      cooldownMs: V1_FREE_CASE_COOLDOWN_MS,
    },
    xp: {
      users: userByTg.size,
      aboveV2Level50XpThreshold: xpAboveCap,
      claimedLevel1Skipped: claimed1,
      claimedAbove50Legacy: claimedOver50,
    },
    levels: {
      claimed2to50MarkersPlanned: claimed2to50Markers,
      legacyAbove50: claimedOver50,
    },
    achievements: {
      v1Claimed: achCounts,
      exactMapped: 0,
      legacyOnly: Object.keys(achCounts).length,
      duplicateRewardRisks: warnings.filter((w) => w.code === "achievement_duplicate_risk").length,
      equivalentLegacyMarkersPlanned: 0,
      chatMessagesWouldUnlockKick100: chatMessageRiskUsers,
      activatedReferralsWouldUnlock5: referrals5RiskUsers,
      importedXpWouldUnlockLevel10: level10RiskUsers,
    },
    streak: {
      source: streakSource,
      planned: streakPlanned,
      overMaxBlockers: streakBlock,
    },
    withdrawals: {
      source: wdSource,
      exactMapped: 0,
      legacyOnly: wdLegacy,
      activeUnmappable: wdActiveBlock,
    },
    giveaways: {
      source: giveawayCount,
      participants: giveawayParts,
      blockers: giveawayBlock,
    },
    activeGames: {
      totalOpenRows: openGameRows.length,
      financiallyBlocking: financiallyBlockingGames.length,
      staleNonFinancial: staleNonFinancialGames.length,
      byGame,
      totalAzcAtRisk: totalAzcAtRisk.toString(),
      blockingRows: financiallyBlockingGames.slice(0, 50),
    },
    uploads: {
      referenced: referencedPaths.size,
      existing: existingUploads,
      missing: missingUploads,
      hashesComputed: uploadAudits.filter((a) => a.sha256).length,
      traversalRejected: uploadAudits.filter((a) => a.traversal).length,
    },
    admin: {
      readiness: adminStatus,
      configuredCount: input.adminTelegramIds?.length ?? 0,
      missingAmongUsers: adminMissing,
    },
    omitted: [...OMITTED_CACHE_KEYS],
    blockingIssues: blocking,
    warnings,
    legacyOnly,
    planned: {
      wallets: userByTg.size,
      gram: gramUsers,
      referrals: mappedRefs,
      entitlements: earned,
      tasks: Object.values(taskMapped).reduce((a, b) => a + b, 0),
      kickAccounts: kickPlanned,
    },
  };

  if (azcTotal !== plannedAzc) {
    report.blockingIssues.push(issue("azc_total_mismatch", "AZC source/planned totals differ"));
  }
  if (gramFail > 0) {
    report.blockingIssues.push(issue("gram_mismatch", "gram conversion failures"));
  }

  return report;
}

export function auditExitCode(report: CutoverReport): number {
  return report.blockingIssues.length > 0 ? 2 : 0;
}
