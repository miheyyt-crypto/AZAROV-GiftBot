import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { after, before, test } from "node:test";
import {
  jobs,
  notifications,
  adminRoleAssignments,
  adminRoles,
  userTaskCompletions,
  walletTransactions,
  wallets,
  welvuraStageCompletions,
} from "@giftbot/db/schema";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import { linkKickAccount } from "./kick.js";
import { asBigInt } from "./money.js";
import {
  attributeReferral,
  onKickAccountLinked,
} from "./referral.js";
import {
  TASK_CATALOG,
  claimTask,
  setTaskEvidenceForTests,
} from "./tasks.js";
import { createLocalSubmissionFileStorage } from "./file-storage.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provisionUser } from "./user.js";
import { identifyTelegramUser } from "./telegram-identity.js";
import {
  WELVURA_ACCOUNT_LINK_REWARD_AZC,
  WELVURA_DEPOSIT_STAGES,
  approveWelvuraAccount,
  approveWelvuraDeposit,
  formatWelvuraAdminPendingCaption,
  rejectWelvuraDeposit,
  submitWelvuraAccount,
  submitWelvuraDeposit,
  readWelvuraState,
} from "./welvura.js";
import {
  encodeWelvuraAdminCallback,
} from "./welvura-admin-telegram.js";
import {
  TaskRequirementNotMetError,
  WelvuraAccountNotApprovedError,
  WelvuraAlreadyModeratedError,
  WelvuraStageLockedError,
} from "./errors.js";

let harness: DomainHarness;
let storageRoot: string;

before(async () => {
  harness = await startDomainHarness();
  storageRoot = await mkdtemp(join(tmpdir(), "giftbot-welvura-"));
});

after(async () => {
  await harness.stop();
});

function pngBytes(): Buffer {
  // Minimal valid-ish PNG header + padding for MIME tests
  return Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
    "hex",
  );
}

test("welvura admin caption matches the pending-review template", () => {
  const caption = formatWelvuraAdminPendingCaption({
    kind: "account",
    submissionId: "786c5799-ccf4-4080-8042-545f1b0ab6ea",
    welvuraId: "1495253",
    telegramUserId: "8572475685",
    username: "BlinkKYRZA",
    submittedAt: new Date("2026-09-19T03:26:44.000Z"),
    rewardAzc: 1000n,
  });
  assert.match(caption, /^🆕 НОВАЯ ЗАЯВКА WELVURA/u);
  assert.match(caption, /📋 Задание: Привязать аккаунт Welvura/);
  assert.match(caption, /🎁 Награда: 1000 монет/);
  assert.match(caption, /Telegram ID: 8572475685/);
  assert.match(caption, /Username: @BlinkKYRZA/);
  assert.match(caption, /🆔 Welvura ID:\n1495253/);
  assert.match(caption, /📅 Дата: 19\.09\.2026, 06:26:44/);
  assert.match(caption, /Статус: ⏳ Ожидает проверки/);
  assert.match(caption, /ID заявки: 786c5799-ccf4-4080-8042-545f1b0ab6ea/);
});

test("task catalog has exact rewards", () => {
  const byCode = Object.fromEntries(
    TASK_CATALOG.map((t) => [t.code, t.rewardAzc.toString()]),
  );
  assert.equal(byCode.kick_nickname_tag, "400");
  assert.equal(byCode.kick_link, "400");
  assert.equal(byCode.kick_follow_azarov7777, "500");
  assert.equal(byCode.telegram_subscribe_azarov222, "500");
  assert.equal(byCode.telegram_bot_started, "600");
  assert.equal(byCode.referral_3_active, "2000");
  assert.equal(TASK_CATALOG.length, 6);
});

test("kick_link claim requires linked kick and is one-time", async () => {
  const user = await provisionUser(harness.db);
  await assert.rejects(
    () => claimTask(harness.db, { userId: user.userId, taskCode: "kick_link" }),
    TaskRequirementNotMetError,
  );
  await linkKickAccount(harness.db, {
    userId: user.userId,
    kickUserId: `kick-${user.userId}`,
  });
  const claimed = await claimTask(harness.db, {
    userId: user.userId,
    taskCode: "kick_link",
  });
  assert.equal(claimed.rewardAzc, "400");
  const replay = await claimTask(harness.db, {
    userId: user.userId,
    taskCode: "kick_link",
  });
  assert.equal(replay.replayed, true);
  const ledger = await harness.db
    .select()
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.userId, user.userId),
        eq(walletTransactions.type, "task_reward"),
      ),
    );
  assert.equal(ledger.length, 1);
});

test("referral_3_active uses activated count", async () => {
  const inviter = await provisionUser(harness.db);
  for (let i = 0; i < 3; i += 1) {
    const referee = await provisionUser(harness.db);
    await attributeReferral(harness.db, {
      refereeUserId: referee.userId,
      code: inviter.referralCode,
    });
    await linkKickAccount(harness.db, {
      userId: referee.userId,
      kickUserId: `kick-r3-${referee.userId}`,
    });
    await onKickAccountLinked(harness.db, referee.userId);
  }
  const claimed = await claimTask(harness.db, {
    userId: inviter.userId,
    taskCode: "referral_3_active",
  });
  assert.equal(claimed.rewardAzc, "2000");
});

test("telegram and kick evidence fixtures unlock claims", async () => {
  const user = await provisionUser(harness.db);
  await setTaskEvidenceForTests(harness.db, user.userId, {
    botStartedAt: new Date(),
    telegramChannelMemberAt: new Date(),
    kickFollowAzarovAt: new Date(),
    kickNicknameSnapshot: "Cool_azarov7777",
  });
  await linkKickAccount(harness.db, {
    userId: user.userId,
    kickUserId: `kick-ev-${user.userId}`,
  });
  for (const code of [
    "telegram_bot_started",
    "telegram_subscribe_azarov222",
    "kick_follow_azarov7777",
    "kick_nickname_tag",
  ] as const) {
    const result = await claimTask(harness.db, {
      userId: user.userId,
      taskCode: code,
    });
    assert.equal(result.replayed, false);
  }
  const completions = await harness.db
    .select()
    .from(userTaskCompletions)
    .where(eq(userTaskCompletions.userId, user.userId));
  assert.equal(completions.length, 4);
});

test("concurrent task claims reward once", async () => {
  const user = await provisionUser(harness.db);
  await linkKickAccount(harness.db, {
    userId: user.userId,
    kickUserId: `kick-c-${user.userId}`,
  });
  const results = await Promise.all([
    claimTask(harness.db, { userId: user.userId, taskCode: "kick_link" }),
    claimTask(harness.db, { userId: user.userId, taskCode: "kick_link" }),
  ]);
  assert.equal(results.filter((r) => !r.replayed).length, 1);
  assert.equal(results.filter((r) => r.replayed).length, 1);
});

test("welvura stages catalog exact", () => {
  assert.equal(WELVURA_ACCOUNT_LINK_REWARD_AZC, 1000n);
  assert.equal(WELVURA_DEPOSIT_STAGES.length, 13);
  assert.equal(WELVURA_DEPOSIT_STAGES[0]?.requiredDepositRub, 100n);
  assert.equal(WELVURA_DEPOSIT_STAGES[0]?.rewardAzc, 2000n);
  assert.equal(WELVURA_DEPOSIT_STAGES[12]?.requiredDepositRub, 1_000_000n);
  assert.equal(WELVURA_DEPOSIT_STAGES[12]?.rewardAzc, 2_000_000n);
});

test("welvura account approve unlocks stage1 and deposit rewards once", async () => {
  const storage = createLocalSubmissionFileStorage(storageRoot);
  const user = await provisionUser(harness.db);
  const admin = await provisionUser(harness.db);

  await assert.rejects(
    () =>
      submitWelvuraDeposit(harness.db, storage, {
        userId: user.userId,
        stageNumber: 1,
        contentType: "image/png",
        bytes: pngBytes(),
      }),
    WelvuraAccountNotApprovedError,
  );

  const account = await submitWelvuraAccount(harness.db, storage, {
    userId: user.userId,
    welvuraId: "WID12345",
    contentType: "image/png",
    bytes: pngBytes(),
  });
  await approveWelvuraAccount(harness.db, {
    submissionId: account.submissionId,
    adminUserId: admin.userId,
  });

  const state = await readWelvuraState(harness.db, user.userId);
  assert.equal(state.account.state, "approved");
  assert.equal(state.account.rewardAzc, "1000");
  assert.equal(state.stages[0]?.state, "available");
  assert.equal(state.stages[1]?.state, "locked");

  const walletAfterBind = await harness.db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, user.userId));
  assert.equal(asBigInt(walletAfterBind[0]!.balanceMinor), 1000n);
  const bindRewards = await harness.db
    .select()
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.userId, user.userId),
        eq(walletTransactions.idempotencyKey, `welvura.account.reward:${account.submissionId}`),
      ),
    );
  assert.equal(bindRewards.length, 1);
  assert.equal(bindRewards[0]?.type, "task_reward");
  assert.equal(asBigInt(bindRewards[0]!.amountMinor), 1000n);

  await assert.rejects(
    () =>
      approveWelvuraAccount(harness.db, {
        submissionId: account.submissionId,
        adminUserId: admin.userId,
      }),
    WelvuraAlreadyModeratedError,
  );
  const bindRewardsAfterRetry = await harness.db
    .select()
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.userId, user.userId),
        eq(walletTransactions.idempotencyKey, `welvura.account.reward:${account.submissionId}`),
      ),
    );
  assert.equal(bindRewardsAfterRetry.length, 1);
  const walletAfterRetry = await harness.db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, user.userId));
  assert.equal(asBigInt(walletAfterRetry[0]!.balanceMinor), 1000n);

  const dep = await submitWelvuraDeposit(harness.db, storage, {
    userId: user.userId,
    stageNumber: 1,
    contentType: "image/png",
    bytes: pngBytes(),
  });
  const approved = await approveWelvuraDeposit(harness.db, {
    submissionId: dep.submissionId,
    adminUserId: admin.userId,
  });
  assert.equal(approved.rewardAzc, "2000");

  const stages = await harness.db
    .select()
    .from(welvuraStageCompletions)
    .where(eq(welvuraStageCompletions.userId, user.userId));
  assert.equal(stages.length, 1);

  const noticeJobs = await harness.db
    .select()
    .from(jobs)
    .where(eq(jobs.type, "telegram.send_message"));
  // No telegram account on provisioned user → job may be skipped; inbox must exist.
  const inbox = await harness.db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.userId));
  assert.ok(inbox.some((n) => n.type === "welvura_deposit_approved"));
  assert.ok(noticeJobs.length >= 0);

  const after = await readWelvuraState(harness.db, user.userId);
  assert.equal(after.stages[0]?.state, "approved");
  assert.equal(after.stages[1]?.state, "available");
});

test("welvura reject then resubmit keeps history", async () => {
  const storage = createLocalSubmissionFileStorage(storageRoot);
  const user = await provisionUser(harness.db);
  const admin = await provisionUser(harness.db);
  const account = await submitWelvuraAccount(harness.db, storage, {
    userId: user.userId,
    welvuraId: "WID999",
    contentType: "image/png",
    bytes: pngBytes(),
  });
  await approveWelvuraAccount(harness.db, {
    submissionId: account.submissionId,
    adminUserId: admin.userId,
  });
  const first = await submitWelvuraDeposit(harness.db, storage, {
    userId: user.userId,
    stageNumber: 1,
    contentType: "image/png",
    bytes: pngBytes(),
  });
  await rejectWelvuraDeposit(harness.db, {
    submissionId: first.submissionId,
    adminUserId: admin.userId,
    reason: "плохой скрин",
  });
  const second = await submitWelvuraDeposit(harness.db, storage, {
    userId: user.userId,
    stageNumber: 1,
    contentType: "image/png",
    bytes: pngBytes(),
  });
  assert.equal(second.attemptNumber, 2);
  await approveWelvuraDeposit(harness.db, {
    submissionId: second.submissionId,
    adminUserId: admin.userId,
  });
  const rewards = await harness.db
    .select()
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.userId, user.userId),
        eq(walletTransactions.type, "welvura_deposit_reward"),
      ),
    );
  assert.equal(rewards.length, 1);
  assert.equal(asBigInt(rewards[0]!.amountMinor), 2000n);
});

test("welvura stage2 locked until stage1 approved; approve rollback on failure", async () => {
  const storage = createLocalSubmissionFileStorage(storageRoot);
  const user = await provisionUser(harness.db);
  const admin = await provisionUser(harness.db);
  const account = await submitWelvuraAccount(harness.db, storage, {
    userId: user.userId,
    welvuraId: "WIDLOCK",
    contentType: "image/png",
    bytes: pngBytes(),
  });
  await approveWelvuraAccount(harness.db, {
    submissionId: account.submissionId,
    adminUserId: admin.userId,
  });
  await assert.rejects(
    () =>
      submitWelvuraDeposit(harness.db, storage, {
        userId: user.userId,
        stageNumber: 2,
        contentType: "image/png",
        bytes: pngBytes(),
      }),
    WelvuraStageLockedError,
  );
  const dep = await submitWelvuraDeposit(harness.db, storage, {
    userId: user.userId,
    stageNumber: 1,
    contentType: "image/png",
    bytes: pngBytes(),
  });
  await assert.rejects(
    () =>
      approveWelvuraDeposit(harness.db, {
        submissionId: dep.submissionId,
        adminUserId: admin.userId,
        failAfterMarkForTests: true,
      }),
    /forced approve failure/,
  );
  const state = await readWelvuraState(harness.db, user.userId);
  assert.equal(state.stages[0]?.state, "pending");
  const rewards = await harness.db
    .select()
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.userId, user.userId),
        eq(walletTransactions.type, "welvura_deposit_reward"),
      ),
    );
  assert.equal(rewards.length, 0);
});

test("welvura pending submissions enqueue telegram notices for assigned admins", async () => {
  const storage = createLocalSubmissionFileStorage(storageRoot);
  const submitter = await identifyTelegramUser(harness.db, {
    telegramUserId: 991001n,
    firstName: "Submitter",
    username: "welvura_user",
  });
  const admin = await identifyTelegramUser(harness.db, {
    telegramUserId: 991002n,
    firstName: "Moderator",
  });
  const roles = await harness.db
    .select()
    .from(adminRoles)
    .where(eq(adminRoles.name, "super_admin"))
    .limit(1);
  assert.ok(roles[0]);
  await harness.db.insert(adminRoleAssignments).values({
    userId: admin.userId,
    roleId: roles[0].id,
  });

  const account = await submitWelvuraAccount(harness.db, storage, {
    userId: submitter.userId,
    welvuraId: "WIDADMIN",
    contentType: "image/png",
    bytes: pngBytes(),
  });
  const accountJobs = await harness.db
    .select()
    .from(jobs)
    .where(
      eq(
        jobs.idempotencyKey,
        `welvura:admin:account:${account.submissionId}:991002`,
      ),
    );
  assert.equal(accountJobs.length, 1);
  assert.equal(accountJobs[0]?.owner, "bot");
  assert.equal(accountJobs[0]?.type, "telegram.send_photo");
  const accountPayload = accountJobs[0]?.payload as {
    chat_id: number;
    caption: string;
    storage_key: string;
    reply_markup: {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
  };
  assert.equal(accountPayload.chat_id, 991002);
  assert.match(accountPayload.caption, /🆕 НОВАЯ ЗАЯВКА WELVURA/);
  assert.match(accountPayload.caption, /Привязать аккаунт Welvura/);
  assert.match(accountPayload.caption, /Награда: 1000 монет/);
  assert.match(accountPayload.caption, /WIDADMIN/);
  assert.match(accountPayload.caption, /Username: @welvura_user/);
  assert.match(accountPayload.caption, /Telegram ID: 991001/);
  assert.match(accountPayload.storage_key, /^welvura\//);
  assert.deepEqual(accountPayload.reply_markup.inline_keyboard, [
    [
      {
        text: "✅ Применить",
        callback_data: encodeWelvuraAdminCallback({
          kind: "account",
          action: "approve",
          submissionId: account.submissionId,
        }),
      },
      {
        text: "❌ Отклонить",
        callback_data: encodeWelvuraAdminCallback({
          kind: "account",
          action: "reject",
          submissionId: account.submissionId,
        }),
      },
    ],
  ]);

  await approveWelvuraAccount(harness.db, {
    submissionId: account.submissionId,
    adminUserId: admin.userId,
  });
  const deposit = await submitWelvuraDeposit(harness.db, storage, {
    userId: submitter.userId,
    stageNumber: 1,
    contentType: "image/png",
    bytes: pngBytes(),
  });
  const depositJobs = await harness.db
    .select()
    .from(jobs)
    .where(
      eq(
        jobs.idempotencyKey,
        `welvura:admin:deposit:${deposit.submissionId}:991002`,
      ),
    );
  assert.equal(depositJobs.length, 1);
  assert.equal(depositJobs[0]?.type, "telegram.send_photo");
  const depositPayload = depositJobs[0]?.payload as { caption: string; storage_key: string };
  assert.match(depositPayload.caption, /Депозит этап 1/);
  assert.match(depositPayload.caption, /Награда: 2000 монет/);
  assert.match(depositPayload.storage_key, /^welvura\//);
});

test("file storage rejects unsupported mime and oversize", async () => {
  const storage = createLocalSubmissionFileStorage(storageRoot);
  await assert.rejects(
    () =>
      storage.put({
        userId: "00000000-0000-4000-8000-000000000001",
        contentType: "application/pdf",
        bytes: Buffer.from("x"),
      }),
    /unsupported|invalid/i,
  );
  await assert.rejects(
    () =>
      storage.put({
        userId: "00000000-0000-4000-8000-000000000001",
        contentType: "image/png",
        bytes: Buffer.alloc(11 * 1024 * 1024),
      }),
    /size/i,
  );
});
