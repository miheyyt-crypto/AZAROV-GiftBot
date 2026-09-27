import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const id = "1bbf8692-13f0-45b6-b8de-465254a84773";
const rows = await sql`
  select id::text, status::text, recipient_count, sent_count, failed_count,
         started_at, completed_at
  from telegram_broadcasts
  where id = ${id}
`;
const recipients = await sql`
  select status::text, count(*)::int as n
  from telegram_broadcast_recipients
  where broadcast_id = ${id}
  group by status
  order by status
`;
const jobs = await sql`
  select status::text, count(*)::int as n
  from jobs
  where idempotency_key like ${"telegram:broadcast:" + id + ":%"}
  group by status
  order by status
`;
const errors = await sql`
  select last_error, count(*)::int as n
  from telegram_broadcast_recipients
  where broadcast_id = ${id} and status = 'failed'
  group by last_error
  order by n desc
  limit 10
`;
console.log(JSON.stringify({ broadcast: rows[0], recipients, jobs, errors }, null, 2));
await sql.end({ timeout: 5 });
