import { createDb } from "@giftbot/db";
import { adjustWallet, InsufficientFundsError } from "@giftbot/domain";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const DEBIT = -75000n;
const { db, sql } = createDb(url, { max: 2 });

try {
  const users = await sql`
    select u.id::text as id, t.username, t.telegram_user_id::text as telegram_user_id
    from telegram_accounts t
    join users u on u.id = t.user_id
    where t.is_active = true and lower(t.username) = 'blttz'
    limit 1
  `;
  const target = users[0];
  if (!target) {
    throw new Error("user @Blttz not found");
  }

  const walletBefore = await sql`
    select id::text as id, balance_minor::text as balance, status
    from wallets
    where user_id = ${target.id}
    limit 1
  `;

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

  const idempotencyKey = `wallet.adjust:${target.id}:debit-75000:2026-09-23`;
  try {
    const result = await adjustWallet(db, {
      targetUserId: target.id,
      amountMinor: DEBIT,
      reason: "Админ списание 75000 AZC",
      idempotencyKey,
      adminUserId,
    });
    console.log(
      JSON.stringify(
        {
          username: target.username,
          telegramUserId: target.telegram_user_id,
          userId: target.id,
          before: walletBefore[0] ?? null,
          replayed: result.replayed,
          auditId: result.auditId ?? null,
          transactionId: result.applied.transaction.id,
          amountMinor: String(result.applied.transaction.amountMinor),
          balanceAfter: String(result.applied.wallet.balanceMinor),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (error instanceof InsufficientFundsError) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            code: "INSUFFICIENT_FUNDS",
            username: target.username,
            userId: target.id,
            before: walletBefore[0] ?? null,
            requestedDebit: "75000",
          },
          null,
          2,
        ),
      );
      process.exitCode = 2;
    } else {
      throw error;
    }
  }
} finally {
  await sql.end({ timeout: 5 });
}
