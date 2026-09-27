import {
  jobs,
  telegramAccounts,
  telegramBroadcastRecipients,
  telegramBroadcasts,
  users,
} from "@giftbot/db/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import { NotFoundError } from "./errors.js";
import { BROADCAST_PHOTO_KEY_RE } from "./file-storage.js";
import { normalizeHttpsAvatarUrl } from "./https-url.js";
import {
  assertTelegramHtmlLength,
  BroadcastInvalidError,
  sanitizeTelegramHtml,
  telegramHtmlFitsCaption,
} from "./telegram-html.js";

export const BROADCAST_JOB_PRIORITY = -10;
export const BROADCAST_LIST_LIMIT = 40;

export type BroadcastButton = {
  kind: "url" | "web_app";
  text: string;
  url: string;
};

export type BroadcastView = {
  id: string;
  status: string;
  messageText: string;
  photoKey: string | null;
  photoUrl: string | null;
  parseMode: string;
  button: BroadcastButton | null;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

type TelegramReplyMarkup = {
  inline_keyboard: Array<
    Array<
      | { text: string; url: string }
      | { text: string; web_app: { url: string } }
    >
  >;
};

export type BroadcastRecipient = {
  userId: string;
  telegramUserId: bigint;
};

function previewOf(text: string): string {
  const plain = text.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
  return plain.length <= 50 ? plain : `${plain.slice(0, 50)}…`;
}

function asButton(value: unknown): BroadcastButton | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (row.kind !== "url" && row.kind !== "web_app") {
    return null;
  }
  if (typeof row.text !== "string" || typeof row.url !== "string") {
    return null;
  }
  return { kind: row.kind, text: row.text, url: row.url };
}

function toView(row: typeof telegramBroadcasts.$inferSelect): BroadcastView {
  const photoKey = row.photoKey ?? null;
  return {
    id: row.id,
    status: row.status,
    messageText: row.messageText,
    photoKey,
    photoUrl: photoKey ? `/broadcasts/media/${photoKey.slice("broadcasts/".length)}` : null,
    parseMode: row.parseMode,
    button: asButton(row.button),
    recipientCount: row.recipientCount,
    sentCount: row.sentCount,
    failedCount: row.failedCount,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

export function parseBroadcastButton(raw: unknown): BroadcastButton | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  if (typeof raw !== "object") {
    throw new BroadcastInvalidError("button is invalid");
  }
  const row = raw as Record<string, unknown>;
  const kind = row.kind === "web_app" ? "web_app" : row.kind === "url" ? "url" : null;
  const text = typeof row.text === "string" ? row.text.trim() : "";
  const url = typeof row.url === "string" ? normalizeHttpsAvatarUrl(row.url) : null;
  if (!kind || !text || !url) {
    throw new BroadcastInvalidError("button requires text and https url");
  }
  if (text.length > 64) {
    throw new BroadcastInvalidError("button text is too long");
  }
  return { kind, text, url };
}

function replyMarkupOf(button: BroadcastButton | null): TelegramReplyMarkup | undefined {
  if (!button) {
    return undefined;
  }
  if (button.kind === "web_app") {
    return {
      inline_keyboard: [[{ text: button.text, web_app: { url: button.url } }]],
    };
  }
  return {
    inline_keyboard: [[{ text: button.text, url: button.url }]],
  };
}

export async function listBroadcastTelegramRecipients(
  tx: GiftbotTx | GiftbotDb,
): Promise<BroadcastRecipient[]> {
  const rows = await tx
    .select({
      userId: users.id,
      telegramUserId: telegramAccounts.telegramUserId,
    })
    .from(telegramAccounts)
    .innerJoin(users, eq(users.id, telegramAccounts.userId))
    .where(
      and(
        eq(users.status, "active"),
        isNull(users.deletedAt),
        eq(telegramAccounts.isActive, true),
      ),
    );

  const unique = new Map<string, BroadcastRecipient>();
  for (const row of rows) {
    unique.set(String(row.telegramUserId), {
      userId: row.userId,
      telegramUserId: row.telegramUserId,
    });
  }
  return [...unique.values()];
}

export async function countBroadcastTelegramRecipients(
  db: GiftbotDb,
): Promise<number> {
  return (await listBroadcastTelegramRecipients(db)).length;
}

export async function listTelegramBroadcasts(
  db: GiftbotDb,
): Promise<Array<BroadcastView & { messagePreview: string; hasPhoto: boolean }>> {
  const rows = await db
    .select()
    .from(telegramBroadcasts)
    .orderBy(desc(telegramBroadcasts.createdAt))
    .limit(BROADCAST_LIST_LIMIT);
  return rows.map((row) => {
    const view = toView(row);
    return {
      ...view,
      messagePreview: previewOf(view.messageText),
      hasPhoto: Boolean(view.photoKey),
    };
  });
}

export async function getTelegramBroadcast(
  db: GiftbotDb,
  id: string,
): Promise<BroadcastView> {
  const rows = await db
    .select()
    .from(telegramBroadcasts)
    .where(eq(telegramBroadcasts.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new NotFoundError("broadcast not found", "BROADCAST_NOT_FOUND");
  }
  return toView(row);
}

async function insertJob(
  tx: GiftbotTx,
  input: {
    type: "telegram.send_message" | "telegram.send_photo";
    idempotencyKey: string;
    payload: Record<string, unknown>;
  },
): Promise<boolean> {
  const inserted = await tx
    .insert(jobs)
    .values({
      type: input.type,
      owner: "bot",
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      priority: BROADCAST_JOB_PRIORITY,
    })
    .onConflictDoNothing({ target: [jobs.type, jobs.idempotencyKey] })
    .returning({ id: jobs.id });
  return Boolean(inserted[0]);
}

function photoPayload(input: {
  chatId: number;
  caption?: string;
  storageKey: string;
  markup?: TelegramReplyMarkup;
  broadcastId: string;
  telegramUserId: string;
}): Record<string, unknown> {
  return {
    chat_id: input.chatId,
    ...(input.caption ? { caption: input.caption, parse_mode: "HTML" } : {}),
    storage_key: input.storageKey,
    ...(input.markup ? { reply_markup: input.markup } : {}),
    broadcast_id: input.broadcastId,
    broadcast_telegram_user_id: input.telegramUserId,
  };
}

function textPayload(input: {
  chatId: number;
  text: string;
  markup?: TelegramReplyMarkup;
  broadcastId: string;
  telegramUserId: string;
}): Record<string, unknown> {
  return {
    chat_id: input.chatId,
    text: input.text,
    parse_mode: "HTML",
    ...(input.markup ? { reply_markup: input.markup } : {}),
    broadcast_id: input.broadcastId,
    broadcast_telegram_user_id: input.telegramUserId,
  };
}

export async function createAndEnqueueTelegramBroadcast(
  db: GiftbotDb,
  input: {
    adminUserId: string;
    messageText: string;
    photoKey?: string | null;
    button?: unknown;
  },
): Promise<BroadcastView> {
  const html = sanitizeTelegramHtml(input.messageText);
  assertTelegramHtmlLength(html);
  const photoKey = input.photoKey?.trim() ? input.photoKey.trim() : null;
  if (photoKey && !BROADCAST_PHOTO_KEY_RE.test(photoKey)) {
    throw new BroadcastInvalidError("photo key is invalid");
  }
  const button = parseBroadcastButton(input.button);
  const markup = replyMarkupOf(button);
  const splitPhoto = Boolean(photoKey) && !telegramHtmlFitsCaption(html);
  const expectedJobs = splitPhoto ? 2 : 1;

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(telegramBroadcasts)
      .values({
        createdByUserId: input.adminUserId,
        status: "queued",
        messageText: html,
        ...(photoKey ? { photoKey } : {}),
        parseMode: "HTML",
        ...(button ? { button } : {}),
      })
      .returning();
    const broadcast = inserted[0];
    if (!broadcast) {
      throw new Error("broadcast insert failed");
    }

    const recipients = await listBroadcastTelegramRecipients(tx);
    const now = new Date();
    let jobRows = 0;

    for (const recipient of recipients) {
      const chatId = Number(recipient.telegramUserId);
      const tg = String(recipient.telegramUserId);
      await tx
        .insert(telegramBroadcastRecipients)
        .values({
          broadcastId: broadcast.id,
          userId: recipient.userId,
          telegramUserId: recipient.telegramUserId,
          expectedJobs,
        })
        .onConflictDoNothing({
          target: [
            telegramBroadcastRecipients.broadcastId,
            telegramBroadcastRecipients.telegramUserId,
          ],
        });

      if (photoKey && !splitPhoto) {
        const created = await insertJob(tx, {
          type: "telegram.send_photo",
          idempotencyKey: `telegram:broadcast:${broadcast.id}:${tg}`,
          payload: photoPayload({
            chatId,
            caption: html,
            storageKey: photoKey,
            ...(markup ? { markup } : {}),
            broadcastId: broadcast.id,
            telegramUserId: tg,
          }),
        });
        if (created) {
          jobRows += 1;
        }
        continue;
      }

      if (photoKey && splitPhoto) {
        const photoCreated = await insertJob(tx, {
          type: "telegram.send_photo",
          idempotencyKey: `telegram:broadcast:${broadcast.id}:${tg}:photo`,
          payload: photoPayload({
            chatId,
            storageKey: photoKey,
            broadcastId: broadcast.id,
            telegramUserId: tg,
          }),
        });
        const textCreated = await insertJob(tx, {
          type: "telegram.send_message",
          idempotencyKey: `telegram:broadcast:${broadcast.id}:${tg}:text`,
          payload: textPayload({
            chatId,
            text: html,
            ...(markup ? { markup } : {}),
            broadcastId: broadcast.id,
            telegramUserId: tg,
          }),
        });
        if (photoCreated) {
          jobRows += 1;
        }
        if (textCreated) {
          jobRows += 1;
        }
        continue;
      }

      const created = await insertJob(tx, {
        type: "telegram.send_message",
        idempotencyKey: `telegram:broadcast:${broadcast.id}:${tg}`,
        payload: textPayload({
          chatId,
          text: html,
          ...(markup ? { markup } : {}),
          broadcastId: broadcast.id,
          telegramUserId: tg,
        }),
      });
      if (created) {
        jobRows += 1;
      }
    }

    const status =
      recipients.length === 0 ? "completed" : "sending";
    const updated = await tx
      .update(telegramBroadcasts)
      .set({
        status,
        recipientCount: recipients.length,
        startedAt: now,
        ...(recipients.length === 0 ? { completedAt: now } : {}),
      })
      .where(eq(telegramBroadcasts.id, broadcast.id))
      .returning();
    const row = updated[0];
    if (!row) {
      throw new Error("broadcast update failed");
    }
    void jobRows;
    return toView(row);
  });
}

export async function deactivateTelegramAccountByTelegramUserId(
  db: GiftbotDb,
  telegramUserId: bigint,
): Promise<void> {
  await db
    .update(telegramAccounts)
    .set({ isActive: false })
    .where(eq(telegramAccounts.telegramUserId, telegramUserId));
}

export async function recordBroadcastJobOutcome(
  db: GiftbotDb,
  input: {
    broadcastId: string;
    telegramUserId: bigint;
    failed: boolean;
    error?: string;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(telegramBroadcastRecipients)
      .where(
        and(
          eq(telegramBroadcastRecipients.broadcastId, input.broadcastId),
          eq(telegramBroadcastRecipients.telegramUserId, input.telegramUserId),
        ),
      )
      .limit(1)
      .for("update");
    const recipient = rows[0];
    if (!recipient) {
      return;
    }
    if (recipient.status !== "pending") {
      return;
    }
    const completedJobs = recipient.completedJobs + 1;
    let nextStatus: "pending" | "sent" | "failed" = "pending";
    if (input.failed) {
      nextStatus = "failed";
    } else if (completedJobs >= recipient.expectedJobs) {
      nextStatus = "sent";
    }
    await tx
      .update(telegramBroadcastRecipients)
      .set({
        completedJobs,
        status: nextStatus,
        ...(input.error ? { lastError: input.error } : {}),
        updatedAt: new Date(),
      })
      .where(eq(telegramBroadcastRecipients.id, recipient.id));

    if (nextStatus === "sent") {
      await tx
        .update(telegramBroadcasts)
        .set({
          sentCount: sql`${telegramBroadcasts.sentCount} + 1`,
        })
        .where(eq(telegramBroadcasts.id, input.broadcastId));
    } else if (nextStatus === "failed") {
      await tx
        .update(telegramBroadcasts)
        .set({
          failedCount: sql`${telegramBroadcasts.failedCount} + 1`,
        })
        .where(eq(telegramBroadcasts.id, input.broadcastId));
    }

    if (nextStatus === "pending") {
      return;
    }

    const broadcastRows = await tx
      .select()
      .from(telegramBroadcasts)
      .where(eq(telegramBroadcasts.id, input.broadcastId))
      .limit(1)
      .for("update");
    const broadcast = broadcastRows[0];
    if (!broadcast || broadcast.recipientCount <= 0) {
      return;
    }
    if (broadcast.sentCount + broadcast.failedCount < broadcast.recipientCount) {
      return;
    }
    const status =
      broadcast.failedCount > 0 ? "completed_with_errors" : "completed";
    await tx
      .update(telegramBroadcasts)
      .set({
        status,
        completedAt: new Date(),
      })
      .where(eq(telegramBroadcasts.id, input.broadcastId));
  });
}

export function readBroadcastJobRef(payload: unknown): {
  broadcastId: string;
  telegramUserId: bigint;
} | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const row = payload as Record<string, unknown>;
  if (typeof row.broadcast_id !== "string" || row.broadcast_id.length === 0) {
    return null;
  }
  const raw = row.broadcast_telegram_user_id;
  if (typeof raw !== "string" && typeof raw !== "number") {
    return null;
  }
  try {
    return { broadcastId: row.broadcast_id, telegramUserId: BigInt(raw) };
  } catch {
    return null;
  }
}
