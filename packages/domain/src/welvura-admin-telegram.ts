const UUID_RE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CALLBACK_RE = new RegExp(`^wv([ad])([ar]):(${UUID_RE})$`, "i");

export const WELVURA_TELEGRAM_REJECT_REASON = "Отклонено в Telegram";

export type WelvuraAdminCallback = {
  kind: "account" | "deposit";
  action: "approve" | "reject";
  submissionId: string;
};

export type WelvuraAdminInlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export function encodeWelvuraAdminCallback(
  input: WelvuraAdminCallback,
): string {
  const kind = input.kind === "account" ? "a" : "d";
  const action = input.action === "approve" ? "a" : "r";
  return `wv${kind}${action}:${input.submissionId}`;
}

export function parseWelvuraAdminCallback(
  data: string | undefined,
): WelvuraAdminCallback | undefined {
  if (!data) {
    return undefined;
  }
  const match = CALLBACK_RE.exec(data.trim());
  if (!match) {
    return undefined;
  }
  const kind = match[1]?.toLowerCase() === "a" ? "account" : "deposit";
  const action = match[2]?.toLowerCase() === "a" ? "approve" : "reject";
  const submissionId = match[3]?.toLowerCase();
  if (!submissionId) {
    return undefined;
  }
  return { kind, action, submissionId };
}

export function welvuraAdminReviewReplyMarkup(
  kind: "account" | "deposit",
  submissionId: string,
): WelvuraAdminInlineKeyboard {
  return {
    inline_keyboard: [
      [
        {
          text: "✅ Применить",
          callback_data: encodeWelvuraAdminCallback({
            kind,
            action: "approve",
            submissionId,
          }),
        },
        {
          text: "❌ Отклонить",
          callback_data: encodeWelvuraAdminCallback({
            kind,
            action: "reject",
            submissionId,
          }),
        },
      ],
    ],
  };
}

export function formatWelvuraAdminCaptionAfterReview(
  caption: string,
  action: "approve" | "reject",
): string {
  const status =
    action === "approve" ? "Статус: ✅ Подтверждено" : "Статус: ❌ Отклонено";
  if (caption.includes("Статус: ⏳ Ожидает проверки")) {
    return caption.replace("Статус: ⏳ Ожидает проверки", status);
  }
  return `${caption}\n\n${status}`;
}
