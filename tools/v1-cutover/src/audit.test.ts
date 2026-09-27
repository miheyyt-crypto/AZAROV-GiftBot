import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { auditV1Store } from "./audit.js";
import { fixtureStore, withKick } from "./fixtures.js";
import { storeFromObject } from "./parse-store.js";
import { reportContainsSecretLeak } from "./report.js";
import { resolveInsideRoot } from "./uploads.js";

test("identity conversion and exact AZC totals", async () => {
  const report = await auditV1Store({
    store: storeFromObject(fixtureStore()),
    storePath: "memory://fixture",
  });
  assert.equal(report.users.sourceCount, 2);
  assert.equal(report.users.plannedCount, 2);
  assert.equal(report.wallet.sourceTotal, "1500");
  assert.equal(report.wallet.plannedTotal, "1500");
  assert.equal(report.wallet.mismatchCount, 0);
});

test("gram planned totals match 0.51 + 0.005", async () => {
  const report = await auditV1Store({
    store: storeFromObject(fixtureStore()),
    storePath: "memory://fixture",
  });
  assert.equal(report.gram.plannedMinorTotal, "515000000");
  assert.equal(report.gram.roundtripTotal, "0.515");
  assert.equal(report.gram.conversionFailures, 0);
});

test("referral mapping rewarded→activated and case entitlements preserved", async () => {
  const report = await auditV1Store({
    store: storeFromObject(fixtureStore()),
    storePath: "memory://fixture",
  });
  assert.equal(report.referrals.mapped, 1);
  assert.equal(report.referrals.unmapped, 0);
  assert.equal(report.referralCase.earned, 0);
  assert.equal(report.referralCase.availablePlanned, report.referralCase.availableSource);
});

test("manual referral credit of 25 with 5 opened cases preserves availability", async () => {
  const report = await auditV1Store({
    store: storeFromObject(
      fixtureStore({
        users: {
          "8014934649": {
            telegramId: 8014934649,
            balance: 0,
            referralCode: "manual25",
            activeReferrals: 25,
            openedReferralCases: 5,
          },
        },
        referrals: {},
        manualReferralCredits: {
          "manual-referral-credit:8014934649:alldepww-battle-2026-plus25": {
            kind: "manual_referral_credit",
            telegramUserId: 8014934649,
            amount: 25,
            creditKey: "manual-referral-credit:8014934649:alldepww-battle-2026-plus25",
            coinsGranted: true,
          },
        },
      }),
    ),
    storePath: "memory://manual-ref",
  });
  assert.equal(report.referralCase.normalActivated, 0);
  assert.equal(report.referralCase.manualActivatedCredits, 25);
  assert.equal(report.referralCase.canonicalEarnedCredits, 25);
  assert.equal(report.referralCase.earned, 5);
  assert.equal(report.referralCase.consumed, 5);
  assert.equal(report.referralCase.availableSource, 0);
  assert.equal(report.referralCase.availablePlanned, 0);
  assert.equal(report.referralCase.mismatches, 0);
  assert.equal(
    report.blockingIssues.some((i) => i.code === "referral_case_overconsumed"),
    false,
  );
});

test("imported chatMessages >= 100 warns but does not plan equivalent marker", async () => {
  const report = await auditV1Store({
    store: storeFromObject(
      fixtureStore({
        users: {
          "1001": {
            telegramId: 1001,
            balance: 0,
            referralCode: "a",
            chatMessages: 100,
            claimedAchievements: ["chat-messages"],
            claimedLevelRewards: [],
            completedTasks: [],
            activeReferrals: 0,
            openedReferralCases: 0,
          },
        },
        referrals: {},
      }),
    ),
    storePath: "memory://ach-100",
  });
  assert.equal(report.achievements.exactMapped, 0);
  assert.equal(report.achievements.equivalentLegacyMarkersPlanned, 0);
  assert.ok(Number(report.achievements.duplicateRewardRisks) >= 1);
  assert.equal(report.achievements.chatMessagesWouldUnlockKick100, 1);
});

test("empty waiting Rolls does not block; mines debit does", async () => {
  const emptyRolls = await auditV1Store({
    store: storeFromObject(
      fixtureStore({
        rollRounds: { r1: { status: "waiting", players: [], pot: 0 } },
      }),
    ),
    storePath: "memory://rolls-empty",
  });
  assert.equal(emptyRolls.activeGames.financiallyBlocking, 0);
  assert.equal(emptyRolls.activeGames.staleNonFinancial, 1);
  assert.equal(
    emptyRolls.blockingIssues.some((i) => i.code === "unresolved_game"),
    false,
  );

  const rollsBet = await auditV1Store({
    store: storeFromObject(
      fixtureStore({
        rollRounds: {
          r2: { status: "waiting", players: [{ userId: 1001, bet: 40 }], pot: 40 },
        },
      }),
    ),
    storePath: "memory://rolls-bet",
  });
  assert.ok(rollsBet.blockingIssues.some((i) => i.code === "unresolved_game"));
  assert.equal(rollsBet.activeGames.totalAzcAtRisk, "40");
});

test("five activated referrals yield one consumed/available entitlement correctly", async () => {
  const users = {
    "1": {
      telegramId: 1,
      balance: 0,
      referralCode: "r1",
      activeReferrals: 5,
      openedReferralCases: 1,
    },
    "2": { telegramId: 2, balance: 0, referralCode: "r2" },
    "3": { telegramId: 3, balance: 0, referralCode: "r3" },
    "4": { telegramId: 4, balance: 0, referralCode: "r4" },
    "5": { telegramId: 5, balance: 0, referralCode: "r5" },
    "6": { telegramId: 6, balance: 0, referralCode: "r6" },
  };
  const referrals: Record<string, unknown> = {};
  for (const id of [2, 3, 4, 5, 6]) {
    referrals[`1:${id}`] = {
      referrerUserId: 1,
      referredUserId: id,
      status: "rewarded",
    };
  }
  const report = await auditV1Store({
    store: storeFromObject(fixtureStore({ users, referrals })),
    storePath: "memory://refs",
  });
  assert.equal(report.referralCase.earned, 1);
  assert.equal(report.referralCase.consumed, 1);
  assert.equal(report.referralCase.availablePlanned, 0);
  assert.equal(report.referralCase.mismatches, 0);
});

test("missing pending screenshot blocks; deleted rejected does not fabricate", async () => {
  const pending = await auditV1Store({
    store: storeFromObject(
      fixtureStore({
        partnerSubmissions: {
          s1: {
            submissionId: "s1",
            telegramUserId: 1001,
            partnerId: "dragonmoney",
            taskId: "dragonmoney-task-1",
            status: "pending",
            screenshotPath: "partner-submissions/missing.png",
          },
        },
      }),
    ),
    storePath: "memory://pending",
    uploadsRoot: await mkdtemp(join(tmpdir(), "cutover-up-")),
  });
  assert.ok(pending.blockingIssues.some((i) => i.code === "welvura_missing_screenshot"));

  const rejected = await auditV1Store({
    store: storeFromObject(
      fixtureStore({
        partnerSubmissions: {
          s2: {
            submissionId: "s2",
            telegramUserId: 1001,
            partnerId: "dragonmoney",
            taskId: "dragonmoney-task-1",
            status: "rejected",
            screenshotPath: null,
            screenshotDeletedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }),
    ),
    storePath: "memory://rejected",
  });
  assert.equal(
    rejected.blockingIssues.some((i) => i.code === "welvura_missing_screenshot"),
    false,
  );
  assert.ok(
    rejected.legacyOnly.some((i) => i.code === "welvura_rejected_screenshot_omitted"),
  );
});

test("kick plaintext token is never emitted by report", async () => {
  const report = await auditV1Store({
    store: storeFromObject(withKick(fixtureStore())),
    storePath: "memory://kick",
  });
  const json = JSON.stringify(report);
  assert.equal(reportContainsSecretLeak(json), false);
  assert.ok(!json.includes("PLAINTEXT_ACCESS"));
  assert.ok(!json.includes("PLAINTEXT_REFRESH"));
  assert.equal(report.kick.tokenPresentCounts, 1);
  assert.equal(report.kick.tokensEmitted, false);
});

test("current streak >10 blocks", async () => {
  const report = await auditV1Store({
    store: storeFromObject(
      fixtureStore({
        kickStreamStreaks: {
          s: { telegramId: 1001, currentStreak: 11 },
        },
      }),
    ),
    storePath: "memory://streak",
  });
  assert.ok(report.blockingIssues.some((i) => i.code === "streak_over_max"));
});

test("unknown case opening is legacy-only not invented", async () => {
  const report = await auditV1Store({
    store: storeFromObject(
      fixtureStore({
        caseOpenings: {
          o1: { caseId: "rich", rewardId: "unknown-drop", userId: 1001 },
        },
      }),
    ),
    storePath: "memory://case",
  });
  assert.ok(report.legacyOnly.some((i) => i.code === "case_opening_unknown"));
  assert.equal(report.blockingIssues.some((i) => i.code === "case_opening_unknown"), false);
});

test("rich historical mapping preserves old odds in legacy note", async () => {
  const report = await auditV1Store({
    store: storeFromObject(
      fixtureStore({
        caseOpenings: {
          o1: {
            caseId: "rich",
            rewardId: "rich-coins-22222",
            userId: 1001,
            rewardAmount: 22222,
            rewardCurrency: "COINS",
          },
        },
      }),
    ),
    storePath: "memory://rich",
  });
  assert.ok(
    report.legacyOnly.some(
      (i) => i.code === "case_opening_odds_history_only" && i.message.includes("47%"),
    ),
  );
});

test("promo redemptions do not create wallet credit plans", async () => {
  const report = await auditV1Store({
    store: storeFromObject(
      fixtureStore({
        promoCodes: {
          HELLO: { code: "HELLO", reward: 100, maxUses: 10, usedCount: 1, active: true },
        },
        promoUsages: {
          "HELLO:1001": { code: "HELLO", userId: 1001, reward: 100, usedAt: "2026-01-01T00:00:00.000Z" },
        },
      }),
    ),
    storePath: "memory://promo",
  });
  assert.equal(report.wallet.plannedTotal, report.wallet.sourceTotal);
  assert.equal(report.promo.redemptions, 1);
});

test("active unmappable withdrawal blocks", async () => {
  const report = await auditV1Store({
    store: storeFromObject(
      fixtureStore({
        withdrawals: {
          w1: { status: "PENDING", method: "USDT_TRC20" },
        },
      }),
    ),
    storePath: "memory://wd",
  });
  assert.ok(report.blockingIssues.some((i) => i.code === "active_withdrawal_unmapped"));
});

test("pending community-access request blocks", async () => {
  const report = await auditV1Store({
    store: storeFromObject(
      fixtureStore({
        communityAccessRequests: {
          c1: { status: "pending", screenshotPath: "community-access/a.png" },
        },
      }),
    ),
    storePath: "memory://community",
  });
  assert.ok(report.blockingIssues.some((i) => i.code === "active_community_access"));
});

test("fixture claimed achievement is legacy-only not V2-mapped", async () => {
  const report = await auditV1Store({
    store: storeFromObject(fixtureStore()),
    storePath: "memory://ach",
  });
  const claimed = report.achievements.v1Claimed as Record<string, number>;
  assert.equal(claimed["coins-earned"], 1);
  assert.equal(report.achievements.exactMapped, 0);
  assert.ok(report.legacyOnly.some((i) => i.code === "achievement_no_exact_map"));
});

test("active unresolved game blocks", async () => {
  const report = await auditV1Store({
    store: storeFromObject(
      fixtureStore({
        minesGames: { g1: { status: "playing", userId: 1001 } },
      }),
    ),
    storePath: "memory://mines",
  });
  assert.ok(report.blockingIssues.some((i) => i.code === "unresolved_game"));
});

test("free-case cooldown is planned from lastDailyFreeCaseAt + 24h", async () => {
  const report = await auditV1Store({
    store: storeFromObject(fixtureStore()),
    storePath: "memory://free",
  });
  assert.equal(report.freeCase.usersWithCooldown, 1);
  assert.equal(report.freeCase.cooldownMs, 86_400_000);
});

test("path traversal for uploads is rejected", () => {
  assert.equal(resolveInsideRoot("/data/uploads", "../etc/passwd"), null);
  assert.equal(resolveInsideRoot("/data/uploads", "partner-submissions/a.png") !== null, true);
});

test("audit report has no production secret keys", async () => {
  const report = await auditV1Store({
    store: storeFromObject(withKick(fixtureStore())),
    storePath: "memory://sec",
  });
  const json = JSON.stringify(report);
  assert.equal(reportContainsSecretLeak(json), false);
  assert.ok(!json.includes("TELEGRAM_BOT_TOKEN"));
  assert.ok(!json.includes("DATABASE_URL"));
});

test("core tasks are counted as mapped", async () => {
  const report = await auditV1Store({
    store: storeFromObject(fixtureStore()),
    storePath: "memory://tasks",
  });
  const mappings = report.tasks.mappings as Record<string, number>;
  assert.equal(mappings.telegram_subscribe_azarov222, 1);
  assert.equal(mappings.telegram_bot_started, 1);
  assert.equal(mappings.kick_link, 1);
  assert.equal(mappings.kick_follow_azarov7777, 1);
  assert.equal(mappings.kick_nickname_tag, 1);
  assert.equal(mappings.referral_3_active, 1);
});

test("order legacy product handling", async () => {
  const report = await auditV1Store({
    store: storeFromObject(
      fixtureStore({
        orders: {
          o1: {
            orderId: "o1",
            userId: 1001,
            productId: "diamond-autograph",
            status: "completed",
            price: 1,
          },
        },
      }),
    ),
    storePath: "memory://order",
  });
  assert.equal(report.orders.unmappedLegacyProducts, 0);
  const byProduct = report.orders.byProduct as Record<string, number>;
  assert.equal(byProduct["diamond-autograph"], 1);
});
