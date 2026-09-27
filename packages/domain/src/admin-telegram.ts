import {
  adminRoleAssignments,
  jobs,
  telegramAccounts,
  users,
} from "@giftbot/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import type { GiftbotDb, GiftbotTx } from "./db.js";

export async function userIsAssignedAdmin(
  db: GiftbotDb,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: adminRoleAssignments.id })
    .from(adminRoleAssignments)
    .where(eq(adminRoleAssignments.userId, userId))
    .limit(1);
  return Boolean(rows[0]);
}

export type AdminTelegramRecipient = {
  userId: string;
  telegramUserId: bigint;
};

export async function listAdminTelegramRecipients(
  tx: GiftbotTx | GiftbotDb,
): Promise<AdminTelegramRecipient[]> {
  const rows = await tx
    .select({
      userId: users.id,
      telegramUserId: telegramAccounts.telegramUserId,
    })
    .from(adminRoleAssignments)
    .innerJoin(users, eq(users.id, adminRoleAssignments.userId))
    .innerJoin(telegramAccounts, eq(telegramAccounts.userId, users.id))
    .where(
      and(
        eq(users.status, "active"),
        isNull(users.deletedAt),
        eq(telegramAccounts.isActive, true),
      ),
    );

  const unique = new Map<string, AdminTelegramRecipient>();
  for (const row of rows) {
    unique.set(String(row.telegramUserId), {
      userId: row.userId,
      telegramUserId: row.telegramUserId,
    });
  }
  return [...unique.values()];
}

export async function enqueueAdminTelegramNoticesIn(
  tx: GiftbotTx,
  input: {
    idempotencyPrefix: string;
    text?: string;
    caption?: string;
    storageKey?: string;
    replyMarkup?: {
      inline_keyboard: Array<
        Array<
          | { text: string; url: string }
          | { text: string; web_app: { url: string } }
          | { text: string; callback_data: string }
        >
      >;
    };
  },
): Promise<number> {
  const body = input.caption ?? input.text;
  if (!body || body.length === 0) {
    throw new Error("admin telegram notice text is required");
  }
  const recipients = await listAdminTelegramRecipients(tx);
  let created = 0;
  for (const recipient of recipients) {
    const isPhoto = Boolean(input.storageKey);
    const inserted = await tx
      .insert(jobs)
      .values({
        type: isPhoto ? "telegram.send_photo" : "telegram.send_message",
        owner: "bot",
        payload: isPhoto
          ? {
              chat_id: Number(recipient.telegramUserId),
              caption: body,
              storage_key: input.storageKey,
              ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}),
            }
          : {
              chat_id: Number(recipient.telegramUserId),
              text: body,
              ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}),
            },
        idempotencyKey: `${input.idempotencyPrefix}:${String(recipient.telegramUserId)}`,
      })
      .onConflictDoNothing({ target: [jobs.type, jobs.idempotencyKey] })
      .returning({ id: jobs.id });
    if (inserted[0]) {
      created += 1;
    }
  }
  return created;
}
