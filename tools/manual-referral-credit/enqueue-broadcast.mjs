import { createDb } from "@giftbot/db";
import { createAndEnqueueTelegramBroadcast } from "@giftbot/domain";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const messageText = `Покупаю 30 бонусок от 30 людей! 50% от окупа ваши! Получаете накид сразу на аккаунт 

ЗАПУСТИЛ СТРИМ 🚀🚀🚀

Пиши слот +айди от вельвуры в чате на стриме 
👇👇👇👇

https://kick.com/azarov7777
https://kick.com/azarov7777`;

const { db, sql } = createDb(url, { max: 2 });

try {
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

  const created = await createAndEnqueueTelegramBroadcast(db, {
    adminUserId,
    messageText,
  });
  console.log(
    JSON.stringify(
      {
        id: created.id,
        status: created.status,
        recipientCount: created.recipientCount,
        sentCount: created.sentCount,
        failedCount: created.failedCount,
      },
      null,
      2,
    ),
  );
} finally {
  await sql.end({ timeout: 5 });
}
