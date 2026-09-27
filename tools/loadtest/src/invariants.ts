import type { createSql } from "@giftbot/db";

export type InvariantCounts = {
  walletMismatches: number;
  negativeWallets: number;
  rollsPotMismatches: number;
  rollsMultiWinnerRounds: number;
  duplicatePromoRedemptions: number;
};

export async function runPostLoadInvariants(
  sql: ReturnType<typeof createSql>,
): Promise<InvariantCounts> {
  const walletMismatches = await sql<Array<{ c: number }>>`
    select count(*)::int as c
    from wallets w
    where w.balance_minor <> (
      coalesce(w.opening_balance_minor, 0)
      + coalesce((
          select sum(t.amount_minor)
          from wallet_transactions t
          where t.wallet_id = w.id
        ), 0)
    )
  `;

  const negative = await sql<Array<{ c: number }>>`
    select count(*)::int as c from wallets where balance_minor < 0
  `;

  const rollsPot = await sql<Array<{ c: number }>>`
    select count(*)::int as c
    from rolls_rounds r
    where r.status = 'resolved'
      and r.total_pot <> coalesce((
        select sum(p.total_stake) from rolls_participants p where p.round_id = r.id
      ), 0)
  `;

  const rollsWinners = await sql<Array<{ c: number }>>`
    select count(*)::int as c
    from rolls_rounds r
    where r.status = 'resolved'
      and (
        r.winner_user_id is null
        or (
          select count(*) from rolls_rounds r2
          where r2.id = r.id and r2.winner_user_id is not null
        ) <> 1
      )
  `;

  const promoDup = await sql<Array<{ c: number }>>`
    select count(*)::int as c
    from (
      select promo_code_id, user_id, count(*) as n
      from promo_redemptions
      group by promo_code_id, user_id
      having count(*) > 1
    ) x
  `;

  return {
    walletMismatches: walletMismatches[0]?.c ?? -1,
    negativeWallets: negative[0]?.c ?? -1,
    rollsPotMismatches: rollsPot[0]?.c ?? -1,
    rollsMultiWinnerRounds: rollsWinners[0]?.c ?? -1,
    duplicatePromoRedemptions: promoDup[0]?.c ?? -1,
  };
}
