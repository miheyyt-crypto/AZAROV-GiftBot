import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });

const users = await sql`
  select u.id, u.public_id, u.display_name, u.status, u.created_at,
         t.username, t.telegram_user_id::text as telegram_user_id,
         t.first_name, t.last_name, t.is_active
  from telegram_accounts t
  join users u on u.id = t.user_id
  where t.is_active = true and lower(t.username) = 'blttz'
`;
console.log("USER", JSON.stringify(users, null, 2));
const uid = users[0]?.id;
if (!uid) {
  await sql.end({ timeout: 5 });
  process.exit(0);
}

const wallet = await sql`
  select id, balance_minor::text as balance, opening_balance_minor::text as opening,
         version::text as version, status, created_at, updated_at
  from wallets where user_id = ${uid}
`;
console.log("WALLET", JSON.stringify(wallet, null, 2));

const byType = await sql`
  select type::text as type,
         count(*)::int as n,
         coalesce(sum(amount_minor) filter (where amount_minor > 0), 0)::text as credits,
         coalesce(sum(-amount_minor) filter (where amount_minor < 0), 0)::text as debits
  from wallet_transactions
  where user_id = ${uid}
  group by type
  order by type
`;
console.log("BY_TYPE", JSON.stringify(byType, null, 2));

const credits = await sql`
  select created_at, type::text as type, amount_minor::text as amount,
         balance_after_minor::text as after,
         idempotency_key, reference_type, reference_id::text as reference_id,
         actor_type::text as actor_type, actor_id::text as actor_id,
         reason, metadata
  from wallet_transactions
  where user_id = ${uid} and amount_minor > 0
  order by created_at asc, id asc
`;
console.log("CREDITS", JSON.stringify(credits, null, 2));

const shop = await sql`
  select p.created_at, p.status::text as status, p.product_code,
         p.product_name_snapshot, p.price_minor::text as price,
         p.submitted_payload, p.fulfilled_at, p.rejected_at
  from purchases p
  where p.user_id = ${uid}
  order by p.created_at asc
`;
console.log("PURCHASES", JSON.stringify(shop, null, 2));

const welvura500 = await sql`
  select created_at, type::text as type, amount_minor::text as amount,
         idempotency_key, reference_type, reference_id::text as reference_id, reason
  from wallet_transactions
  where user_id = ${uid}
    and (
      idempotency_key ilike '%welvura-500%'
      or (type = 'shop_purchase' and amount_minor = -22222)
      or (type = 'shop_purchase' and amount_minor = -11111)
    )
  order by created_at
`;
console.log("WELVURA500_TX", JSON.stringify(welvura500, null, 2));

const audits = await sql`
  select created_at, action, actor_user_id::text as actor, reason, before, after
  from audit_logs
  where target_id = ${uid} or (after::text ilike ${"%" + uid + "%"})
  order by created_at
  limit 50
`;
console.log("AUDITS", JSON.stringify(audits, null, 2));

await sql.end({ timeout: 5 });
