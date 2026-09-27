import type { createSql } from "@giftbot/db";

export type SeedSummary = {
  users: number;
  wallets: number;
  telegramAccounts: number;
  referralsAttributed: number;
  referralsActivated: number;
  ledgerRows: number;
  hotInviterActivated: number;
  telegramIdBase: number;
  telegramIdMax: number;
};

export const TELEGRAM_ID_BASE = 9_000_000;

/**
 * Bulk-seed a dedicated load DB. Wallet balances paired with deposit ledger rows.
 */
export async function seedLoadDataset(
  sql: ReturnType<typeof createSql>,
  options?: { users?: number },
): Promise<SeedSummary> {
  const users = options?.users ?? 10_000;
  const telegramIdBase = TELEGRAM_ID_BASE;

  await sql.begin(async (tx) => {
    await tx.unsafe(`
      WITH gs AS (
        SELECT generate_series(0, ${users - 1}) AS i
      ),
      ins_users AS (
        INSERT INTO users (id, public_id, display_name, status, created_at, updated_at)
        SELECT
          gen_random_uuid(),
          gen_random_uuid(),
          'LoadUser_' || i::text,
          'active',
          now() - ((${users} - i) || ' seconds')::interval,
          now()
        FROM gs
        RETURNING id, display_name
      ),
      numbered AS (
        SELECT
          id,
          display_name,
          row_number() OVER (ORDER BY display_name) - 1 AS i
        FROM ins_users
      ),
      ins_wallets AS (
        INSERT INTO wallets (
          id, user_id, balance_minor, opening_balance_minor, currency_code, version, status
        )
        SELECT
          gen_random_uuid(),
          n.id,
          CASE
            WHEN n.i % 17 = 0 THEN 250000
            WHEN n.i % 7 = 0 THEN 50000
            WHEN n.i % 3 = 0 THEN 10000
            ELSE (1000 + (n.i % 5000))
          END,
          0,
          'INTERNAL',
          1,
          'active'
        FROM numbered n
        RETURNING id, user_id, balance_minor
      ),
      ins_tg AS (
        INSERT INTO telegram_accounts (
          id, user_id, telegram_user_id, username, first_name, is_active
        )
        SELECT
          gen_random_uuid(),
          n.id,
          (${telegramIdBase} + n.i)::bigint,
          'load' || n.i::text,
          'Load',
          true
        FROM numbered n
      ),
      ins_codes AS (
        INSERT INTO referral_codes (id, user_id, code, is_active)
        SELECT gen_random_uuid(), n.id, 'ld' || lpad(n.i::text, 8, '0'), true
        FROM numbered n
      ),
      ins_ledger AS (
        INSERT INTO wallet_transactions (
          id, wallet_id, user_id, type, amount_minor, balance_after_minor,
          idempotency_key, actor_type, reason, metadata
        )
        SELECT
          gen_random_uuid(),
          w.id,
          w.user_id,
          'deposit',
          w.balance_minor,
          w.balance_minor,
          'loadseed:deposit:' || w.user_id::text,
          'system',
          'load seed opening deposit',
          '{}'::jsonb
        FROM ins_wallets w
      )
      SELECT 1
    `);

    await tx.unsafe(`
      INSERT INTO wallet_transactions (
        id, wallet_id, user_id, type, amount_minor, balance_after_minor,
        idempotency_key, actor_type, reason, metadata
      )
      SELECT
        gen_random_uuid(),
        w.id,
        w.user_id,
        'prize',
        0,
        w.balance_minor,
        'loadseed:noise:' || w.user_id::text || ':' || g.n::text,
        'system',
        'load seed history noise',
        '{}'::jsonb
      FROM wallets w
      CROSS JOIN generate_series(1, 3) AS g(n)
      WHERE (w.user_id::text ~ '[0-3]$')
    `);

    await tx.unsafe(`
      WITH inviters AS (
        SELECT u.id AS referrer_id, rc.code,
          row_number() OVER (ORDER BY u.created_at, u.id) - 1 AS i
        FROM users u
        INNER JOIN referral_codes rc ON rc.user_id = u.id AND rc.is_active = true
        ORDER BY u.created_at, u.id
        LIMIT 50
      ),
      referees AS (
        SELECT u.id AS referee_id,
          row_number() OVER (ORDER BY u.created_at, u.id) - 1 AS i
        FROM users u
        ORDER BY u.created_at, u.id
        OFFSET 50
      )
      INSERT INTO referrals (
        id, referrer_user_id, referee_user_id, referral_code_used,
        status, attributed_at, activated_at
      )
      SELECT
        gen_random_uuid(),
        inv.referrer_id,
        ref.referee_id,
        inv.code,
        CASE
          WHEN ref.i < 150 THEN 'activated'::referral_status
          WHEN ref.i < 400 THEN 'attributed'::referral_status
          ELSE 'attributed'::referral_status
        END,
        now() - (ref.i || ' minutes')::interval,
        CASE
          WHEN ref.i < 150 THEN now() - (ref.i || ' minutes')::interval
          ELSE NULL
        END
      FROM referees ref
      INNER JOIN inviters inv ON inv.i = (ref.i % 50)
      ON CONFLICT (referee_user_id) DO NOTHING
    `);

    await tx.unsafe(`
      WITH hot AS (
        SELECT u.id AS referrer_id, rc.code
        FROM users u
        INNER JOIN referral_codes rc ON rc.user_id = u.id AND rc.is_active = true
        ORDER BY u.created_at ASC, u.id ASC
        LIMIT 1
      ),
      pool AS (
        SELECT u.id AS referee_id
        FROM users u
        WHERE u.id NOT IN (SELECT referee_user_id FROM referrals)
          AND u.id NOT IN (SELECT referrer_id FROM hot)
        ORDER BY u.created_at DESC
        LIMIT 120
      )
      INSERT INTO referrals (
        id, referrer_user_id, referee_user_id, referral_code_used,
        status, attributed_at, activated_at
      )
      SELECT
        gen_random_uuid(),
        hot.referrer_id,
        pool.referee_id,
        hot.code,
        'activated',
        now(),
        now()
      FROM pool
      CROSS JOIN hot
      ON CONFLICT (referee_user_id) DO NOTHING
    `);
  });

  const counts = await sql<
    Array<{
      users: number;
      wallets: number;
      telegram: number;
      attributed: number;
      activated: number;
      ledger: number;
      hot: number;
    }>
  >`
    select
      (select count(*)::int from users) as users,
      (select count(*)::int from wallets) as wallets,
      (select count(*)::int from telegram_accounts) as telegram,
      (select count(*)::int from referrals where status = 'attributed') as attributed,
      (select count(*)::int from referrals where status = 'activated') as activated,
      (select count(*)::int from wallet_transactions) as ledger,
      (
        select count(*)::int from referrals r
        where r.status = 'activated'
          and r.referrer_user_id = (
            select id from users order by created_at asc, id asc limit 1
          )
      ) as hot
  `;

  const row = counts[0]!;
  return {
    users: row.users,
    wallets: row.wallets,
    telegramAccounts: row.telegram,
    referralsAttributed: row.attributed,
    referralsActivated: row.activated,
    ledgerRows: row.ledger,
    hotInviterActivated: row.hot,
    telegramIdBase,
    telegramIdMax: telegramIdBase + users - 1,
  };
}
