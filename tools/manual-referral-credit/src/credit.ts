import { createDb } from "@giftbot/db";
import {
  findUserByTelegramUsername,
  grantManualReferralCredit,
  inspectReferralCreditState,
  previewManualReferralGrant,
} from "@giftbot/domain";

export type ManualReferralCreditFlags = {
  username: string;
  amount: number;
  apply: boolean;
  confirmApply: boolean;
  idempotencyKey?: string;
  databaseUrl: string;
};

export function parseManualReferralCreditArgs(argv: string[]): {
  username?: string;
  amount?: number;
  apply: boolean;
  confirmApply: boolean;
  idempotencyKey?: string;
  databaseUrl?: string;
} {
  const usernameRaw = argValue("--username", argv);
  const amountRaw = argValue("--amount", argv);
  const key = argValue("--idempotency-key", argv);
  const databaseUrl = argValue("--database-url", argv) ?? process.env.DATABASE_URL;
  return {
    ...(usernameRaw ? { username: usernameRaw.replace(/^@/, "").trim() } : {}),
    ...(amountRaw !== undefined ? { amount: Number(amountRaw) } : {}),
    apply: argv.includes("--apply"),
    confirmApply: argv.includes("--confirm-apply"),
    ...(key ? { idempotencyKey: key } : {}),
    ...(databaseUrl ? { databaseUrl } : {}),
  };
}

function argValue(flag: string, argv: string[]): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  return argv[index + 1];
}

export async function runManualReferralCredit(flags: ManualReferralCreditFlags) {
  const handle = createDb(flags.databaseUrl);
  try {
    const user = await findUserByTelegramUsername(handle.db, flags.username);
    const before = await inspectReferralCreditState(handle.db, user);
    const preview = previewManualReferralGrant(before, flags.amount);
    const report = {
      mode: flags.apply && flags.confirmApply ? "apply" : "dry-run",
      user: {
        userId: user.userId,
        publicId: user.publicId,
        username: user.telegramUsername,
        telegramId: user.telegramUserId,
      },
      realActivatedReferrals: before.realActivatedReferrals,
      existingManualCredits: before.existingManualCredits,
      newManualCredits: flags.amount,
      canonicalBefore: preview.canonicalBefore,
      canonicalAfter: preview.canonicalAfter,
      casesEarnedBefore: preview.casesEarnedBefore,
      casesEarnedAfter: preview.casesEarnedAfter,
      casesAvailableBefore: before.casesAvailable,
      rewardPerReferralAzc: preview.rewardPerReferralAzc,
      totalAzcReward: preview.totalAzcReward,
      walletBeforeAzc: preview.walletBeforeAzc,
      walletAfterExpectedAzc: preview.walletAfterAzc,
      applied: false as boolean,
      replayed: false as boolean,
    };

    if (!flags.apply) {
      return report;
    }
    if (!flags.confirmApply) {
      throw new Error("apply requires --confirm-apply");
    }
    if (!flags.idempotencyKey?.trim()) {
      throw new Error("apply requires --idempotency-key");
    }

    const granted = await grantManualReferralCredit(handle.db, {
      userId: user.userId,
      amount: flags.amount,
      idempotencyKey: flags.idempotencyKey.trim(),
      metadata: {
        username: flags.username.replace(/^@/, "").trim(),
        amount: flags.amount,
      },
    });
    const after = await inspectReferralCreditState(handle.db, user);
    return {
      ...report,
      mode: "apply",
      applied: true,
      replayed: granted.replayed,
      creditId: granted.creditId,
      canonicalAfter: after.canonicalActive,
      casesEarnedAfter: after.casesEarned,
      casesAvailableAfter: after.casesAvailable,
      walletAfterAzc: after.walletBalanceAzc,
    };
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
}
