import { createDb } from "@giftbot/db";
import {
  findUserByTelegramUsername,
  grantAdditionalReferralCaseMilestones,
  inspectReferralCreditState,
  writeAuditIn,
} from "@giftbot/domain";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const GRANT = 5;
const { db, sql } = createDb(url, { max: 2 });

try {
  const user = await findUserByTelegramUsername(db, "alldepww");
  const before = await inspectReferralCreditState(db, user);

  const admins = await sql`
    select a.user_id::text as user_id
    from admin_role_assignments a
    join admin_roles r on r.id = a.role_id
    where r.name = 'super_admin'
    limit 1
  `;
  const adminUserId = admins[0]?.user_id;
  if (!adminUserId) {
    throw new Error("no super_admin");
  }

  const granted = await db.transaction(async (tx) => {
    const n = await grantAdditionalReferralCaseMilestones(tx, user.userId, GRANT);
    await writeAuditIn(tx, {
      actorId: adminUserId,
      action: "referral.case.grant",
      targetType: "user",
      targetId: user.userId,
      reason: "Админ выдача 5 реферальных кейсов",
      before: {
        casesEarned: before.casesEarned,
        casesAvailable: before.casesAvailable,
      },
      after: { granted: n },
    });
    return n;
  });

  const after = await inspectReferralCreditState(db, user);
  console.log(
    JSON.stringify(
      {
        username: user.telegramUsername,
        userId: user.userId,
        granted,
        casesAvailableBefore: before.casesAvailable,
        casesAvailableAfter: after.casesAvailable,
        casesEarnedBefore: before.casesEarned,
        casesEarnedAfter: after.casesEarned,
        walletBalanceAzc: after.walletBalanceAzc,
      },
      null,
      2,
    ),
  );
} finally {
  await sql.end({ timeout: 5 });
}
