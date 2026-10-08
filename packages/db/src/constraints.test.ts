import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSql } from "./client.js";
import type { DevPostgres } from "./dev-postgres.js";
import { startDevPostgres } from "./dev-postgres.js";
import { runMigrations } from "./migrate.js";

let postgresHandle: DevPostgres;
let sql: ReturnType<typeof createSql>;

before(async () => {
  postgresHandle = await startDevPostgres({ forceEmbedded: true });
  sql = createSql(postgresHandle.url);
  await runMigrations(postgresHandle.url);
});

after(async () => {
  await sql.end({ timeout: 5 });
  await postgresHandle.stop();
});

test("new wallet starts at zero opening and balance", async () => {
  const [user] = await sql<{ id: string }[]>`
    insert into users (public_id) values (gen_random_uuid())
    returning id
  `;
  assert.ok(user);

  const [wallet] = await sql<
    { balance_minor: string; opening_balance_minor: string }[]
  >`
    insert into wallets (user_id) values (${user.id})
    returning balance_minor, opening_balance_minor
  `;

  assert.equal(wallet?.balance_minor, "0");
  assert.equal(wallet?.opening_balance_minor, "0");
});

test("wallet rejects negative balance", async () => {
  const [user] = await sql<{ id: string }[]>`
    insert into users (public_id) values (gen_random_uuid())
    returning id
  `;
  assert.ok(user);

  await assert.rejects(async () => {
    await sql`
      insert into wallets (user_id, balance_minor) values (${user.id}, -1)
    `;
  });
});

test("ledger idempotency key is unique", async () => {
  const [user] = await sql<{ id: string }[]>`
    insert into users (public_id) values (gen_random_uuid())
    returning id
  `;
  assert.ok(user);
  const [wallet] = await sql<{ id: string }[]>`
    insert into wallets (user_id) values (${user.id})
    returning id
  `;
  assert.ok(wallet);

  await sql`
    insert into wallet_transactions (
      wallet_id, user_id, type, amount_minor, balance_after_minor,
      idempotency_key, actor_type
    ) values (
      ${wallet.id}, ${user.id}, 'reward', 1, 1, 'ledger:dup-test', 'system'
    )
  `;

  await assert.rejects(async () => {
    await sql`
      insert into wallet_transactions (
        wallet_id, user_id, type, amount_minor, balance_after_minor,
        idempotency_key, actor_type
      ) values (
        ${wallet.id}, ${user.id}, 'reward', 1, 2, 'ledger:dup-test', 'system'
      )
    `;
  });
});

test("ledger rows cannot be updated or deleted", async () => {
  const [user] = await sql<{ id: string }[]>`
    insert into users (public_id) values (gen_random_uuid())
    returning id
  `;
  assert.ok(user);
  const [wallet] = await sql<{ id: string }[]>`
    insert into wallets (user_id) values (${user.id})
    returning id
  `;
  assert.ok(wallet);
  const [row] = await sql<{ id: string }[]>`
    insert into wallet_transactions (
      wallet_id, user_id, type, amount_minor, balance_after_minor,
      idempotency_key, actor_type
    ) values (
      ${wallet.id}, ${user.id}, 'reward', 1, 1, 'ledger:immutable-test', 'system'
    )
    returning id
  `;
  assert.ok(row);

  await assert.rejects(async () => {
    await sql`update wallet_transactions set reason = 'edit' where id = ${row.id}`;
  });
  await assert.rejects(async () => {
    await sql`delete from wallet_transactions where id = ${row.id}`;
  });
});

test("inbound event provider + external id is unique", async () => {
  await sql`
    insert into inbound_events (
      provider, event_type, external_event_id, idempotency_key, payload, signature_valid
    ) values (
      'telegram', 'message', '1001', 'telegram:1001', '{}'::jsonb, true
    )
  `;

  await assert.rejects(async () => {
    await sql`
      insert into inbound_events (
        provider, event_type, external_event_id, idempotency_key, payload, signature_valid
      ) values (
        'telegram', 'message', '1001', 'telegram:1001-b', '{}'::jsonb, true
      )
    `;
  });
});

test("jobs type + idempotency key is unique and owner is required", async () => {
  await sql`
    insert into jobs (type, owner, idempotency_key)
    values ('telegram.process_inbound_event', 'bot', 'telegram:1001')
  `;

  await assert.rejects(async () => {
    await sql`
      insert into jobs (type, owner, idempotency_key)
      values ('telegram.process_inbound_event', 'bot', 'telegram:1001')
    `;
  });

  await assert.rejects(async () => {
    await sql.unsafe(`
      insert into jobs (type, owner, idempotency_key)
      values ('telegram.process_inbound_event', 'api', 'telegram:other')
    `);
  });
});

test("there is no second webhook payload table", async () => {
  const tables = await sql<{ tablename: string }[]>`
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename in ('kick_events', 'telegram_events', 'store')
  `;
  assert.equal(tables.length, 0);

  const inbound = await sql<{ tablename: string }[]>`
    select tablename from pg_tables
    where schemaname = 'public' and tablename = 'inbound_events'
  `;
  assert.equal(inbound.length, 1);
});

test("self-referral is rejected", async () => {
  const [user] = await sql<{ id: string }[]>`
    insert into users (public_id) values (gen_random_uuid())
    returning id
  `;
  assert.ok(user);

  await assert.rejects(async () => {
    await sql`
      insert into referrals (
        referrer_user_id, referee_user_id, referral_code_used
      ) values (${user.id}, ${user.id}, 'self')
    `;
  });
});

test("gram balance cannot be negative", async () => {
  const [user] = await sql<{ id: string }[]>`
    insert into users (public_id) values (gen_random_uuid())
    returning id
  `;
  assert.ok(user);
  await assert.rejects(async () => {
    await sql`
      insert into gram_balances (user_id, amount_minor) values (${user.id}, -1)
    `;
  });
});

test("gram reserved cannot exceed balance or go negative", async () => {
  const [user] = await sql<{ id: string }[]>`
    insert into users (public_id) values (gen_random_uuid())
    returning id
  `;
  assert.ok(user);
  await assert.rejects(async () => {
    await sql`
      insert into gram_balances (user_id, amount_minor, reserved_minor)
      values (${user.id}, 10, 11)
    `;
  });
  const [second] = await sql<{ id: string }[]>`
    insert into users (public_id) values (gen_random_uuid())
    returning id
  `;
  assert.ok(second);
  await assert.rejects(async () => {
    await sql`
      insert into gram_balances (user_id, amount_minor, reserved_minor)
      values (${second.id}, 10, -1)
    `;
  });
});

test("only one active gram withdrawal per user and amount must be positive", async () => {
  const [user] = await sql<{ id: string }[]>`
    insert into users (public_id) values (gen_random_uuid())
    returning id
  `;
  assert.ok(user);
  await sql`
    insert into gram_balances (user_id, amount_minor, reserved_minor)
    values (${user.id}, 20000000000, 0)
  `;
  await sql`
    insert into gram_withdrawals (
      user_id, amount_minor, telegram_username, idempotency_key
    ) values (${user.id}, 20000000000, 'user_one', 'gram:one')
  `;
  await assert.rejects(async () => {
    await sql`
      insert into gram_withdrawals (
        user_id, amount_minor, telegram_username, idempotency_key
      ) values (${user.id}, 20000000000, 'user_two', 'gram:two')
    `;
  });
  const [other] = await sql<{ id: string }[]>`
    insert into users (public_id) values (gen_random_uuid())
    returning id
  `;
  assert.ok(other);
  await assert.rejects(async () => {
    await sql`
      insert into gram_withdrawals (
        user_id, amount_minor, telegram_username, idempotency_key
      ) values (${other.id}, 0, 'user_zero', 'gram:zero')
    `;
  });
});

test("only one active cash withdrawal per inventory item and amount must be positive", async () => {
  const [user] = await sql<{ id: string }[]>`
    insert into users (public_id) values (gen_random_uuid())
    returning id
  `;
  assert.ok(user);
  const [item] = await sql<{ id: string }[]>`
    insert into inventory_items (
      user_id, item_type, status, quantity, amount_rub, source
    ) values (${user.id}, 'cash_rub', 'available', 1, 1000, 'free_case')
    returning id
  `;
  assert.ok(item);
  await sql`
    insert into cash_item_withdrawals (
      user_id, inventory_item_id, amount_rub, welvura_id, idempotency_key
    ) values (${user.id}, ${item.id}, 1000, 'wid_one', 'cash:one')
  `;
  await assert.rejects(async () => {
    await sql`
      insert into cash_item_withdrawals (
        user_id, inventory_item_id, amount_rub, welvura_id, idempotency_key
      ) values (${user.id}, ${item.id}, 1000, 'wid_two', 'cash:two')
    `;
  });
  await assert.rejects(async () => {
    await sql`
      insert into cash_item_withdrawals (
        user_id, inventory_item_id, amount_rub, welvura_id, idempotency_key
      ) values (${user.id}, ${item.id}, 0, 'wid_zero', 'cash:zero')
    `;
  });
});

test("shop catalog seed has the approved product prices", async () => {
  const rows = await sql<{ slug: string; price_minor: string }[]>`
    select slug, price_minor::text as price_minor
    from products
    where slug in (
      'welvura-200', 'welvura-500', 'welvura-5000', 'donat', 'music',
      'streak-freeze', 'vip-kick'
    )
    order by slug
  `;
  const bySlug = Object.fromEntries(rows.map((row) => [row.slug, row.price_minor]));
  assert.equal(bySlug["welvura-200"], "11111");
  assert.equal(bySlug["welvura-500"], "22222");
  assert.equal(bySlug["welvura-5000"], "199999");
  assert.equal(bySlug["donat"], "1000");
  assert.equal(bySlug["music"], "4000");
  assert.equal(bySlug["streak-freeze"], "1000");
  assert.equal(bySlug["vip-kick"], "149999");
  assert.equal(rows.length, 7);

  const retired = await sql<{ slug: string; status: string }[]>`
    select slug, status::text as status
    from products
    where slug in ('premium-6', 'premium-12')
    order by slug
  `;
  assert.equal(retired.length, 2);
  assert.ok(retired.every((row) => row.status === "disabled"));

  const types = await sql<{ typname: string }[]>`
    select unnest(enum_range(NULL::wallet_transaction_type))::text as typname
  `;
  const names = types.map((row) => row.typname);
  assert.ok(names.includes("shop_purchase"));
  assert.ok(names.includes("shop_refund"));
  assert.ok(names.includes("referral_contest_reward"));
  assert.ok(names.includes("stream_donation"));

  const streamCols = await sql<{ column_name: string }[]>`
    select column_name
    from information_schema.columns
    where table_name = 'stream_donations'
      and column_name in ('shop_purchase_id', 'tts_status', 'playing_expires_at', 'kind', 'media_storage_key')
  `;
  assert.equal(streamCols.length, 5);
  const streamIndexes = await sql<{ indexname: string }[]>`
    select indexname
    from pg_indexes
    where tablename = 'stream_donations'
      and indexname = 'stream_donations_shop_purchase_unique'
  `;
  assert.equal(streamIndexes.length, 1);
});

test("super_admin role exists and no admin identities are seeded", async () => {
  const roles = await sql<{ name: string }[]>`
    select name from admin_roles
  `;
  assert.deepEqual(roles.map((row) => row.name), ["super_admin"]);

  const assignments = await sql<{ count: string }[]>`
    select count(*)::text as count from admin_role_assignments
  `;
  assert.equal(assignments[0]?.count, "0");
});

test("promo codes reject duplicate normalized codes and over-limit counts", async () => {
  const [first] = await sql<{ id: string }[]>`
    insert into promo_codes (code, normalized_code, reward_azc, activation_limit)
    values ('AZAROV', 'AZAROV', 999, 100)
    returning id
  `;
  assert.ok(first);

  await assert.rejects(async () => {
    await sql`
      insert into promo_codes (code, normalized_code, reward_azc, activation_limit)
      values ('azarov', 'AZAROV', 1, 1)
    `;
  });
  await assert.rejects(async () => {
    await sql`
      insert into promo_codes (code, normalized_code, reward_azc, activation_limit)
      values ('ZERO', 'ZERO', 0, 1)
    `;
  });
  await assert.rejects(async () => {
    await sql`
      insert into promo_codes (code, normalized_code, reward_azc, activation_limit)
      values ('NOLIM', 'NOLIM', 1, 0)
    `;
  });
  await assert.rejects(async () => {
    await sql`
      insert into promo_codes (
        code, normalized_code, reward_azc, activation_limit, activation_count
      ) values ('OVER', 'OVER', 1, 1, 2)
    `;
  });
});

test("promo redemptions are unique per user and promo", async () => {
  const [user] = await sql<{ id: string }[]>`
    insert into users (public_id) values (gen_random_uuid())
    returning id
  `;
  assert.ok(user);
  const [promo] = await sql<{ id: string }[]>`
    insert into promo_codes (code, normalized_code, reward_azc, activation_limit)
    values ('ONCE', 'ONCE', 5, 10)
    returning id
  `;
  assert.ok(promo);

  await sql`
    insert into promo_redemptions (
      promo_code_id, user_id, reward_azc, idempotency_key
    ) values (${promo.id}, ${user.id}, 5, 'promo:once:a')
  `;
  await assert.rejects(async () => {
    await sql`
      insert into promo_redemptions (
        promo_code_id, user_id, reward_azc, idempotency_key
      ) values (${promo.id}, ${user.id}, 5, 'promo:once:b')
    `;
  });
});

test("free case openings require positive weight and unique user idempotency", async () => {
  const [user] = await sql<{ id: string }[]>`
    insert into users (public_id) values (gen_random_uuid())
    returning id
  `;
  assert.ok(user);
  await sql`
    insert into free_case_openings (
      user_id, item_code, title_snapshot, rarity, reward_type,
      reward_snapshot, real_weight, display_chance, real_chance,
      opened_at, next_available_at, idempotency_key
    ) values (
      ${user.id}, 'azc-25', '25 AZC', 'common', 'azc',
      '{}'::jsonb, 99986, '12.33', '16.664333333333',
      now(), now() + interval '24 hours', 'free:db:one'
    )
  `;
  await assert.rejects(async () => {
    await sql`
      insert into free_case_openings (
        user_id, item_code, title_snapshot, rarity, reward_type,
        reward_snapshot, real_weight, display_chance, real_chance,
        opened_at, next_available_at, idempotency_key
      ) values (
        ${user.id}, 'azc-25', '25 AZC', 'common', 'azc',
        '{}'::jsonb, 99986, '12.33', '16.664333333333',
        now(), now() + interval '24 hours', 'free:db:one'
      )
    `;
  });
  await assert.rejects(async () => {
    await sql`
      insert into free_case_openings (
        user_id, item_code, title_snapshot, rarity, reward_type,
        reward_snapshot, real_weight, display_chance, real_chance,
        opened_at, next_available_at, idempotency_key
      ) values (
        ${user.id}, 'azc-25', '25 AZC', 'common', 'azc',
        '{}'::jsonb, 0, '12.33', '16.664333333333',
        now(), now() + interval '24 hours', 'free:db:zero'
      )
    `;
  });
});

test("external_prize inventory rows omit amount_rub", async () => {
  const [user] = await sql<{ id: string }[]>`
    insert into users (public_id) values (gen_random_uuid())
    returning id
  `;
  assert.ok(user);
  await sql`
    insert into inventory_items (
      user_id, item_type, status, quantity, source, item_code, title
    ) values (
      ${user.id}, 'external_prize', 'available', 1, 'free_case',
      'nft-loot-bag', 'Loot Bag NFT'
    )
  `;
  await assert.rejects(async () => {
    await sql`
      insert into inventory_items (
        user_id, item_type, status, quantity, amount_rub, source
      )       values (
        ${user.id}, 'external_prize', 'available', 1, 100, 'free_case'
      )
    `;
  });
});

test("rolls spin_duration_ms column default is 8000", async () => {
  const rows = await sql<{ column_default: string }[]>`
    select column_default
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rolls_rounds'
      and column_name = 'spin_duration_ms'
  `;
  assert.equal(rows.length, 1);
  assert.match(rows[0]!.column_default, /8000/);
  assert.doesNotMatch(rows[0]!.column_default, /10000/);
});
