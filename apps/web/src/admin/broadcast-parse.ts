export type AdminBroadcastItem = {
  id: string;
  status: string;
  messageText: string;
  messagePreview: string;
  hasPhoto: boolean;
  photoUrl: string | null;
  button: { kind: "url" | "web_app"; text: string; url: string } | null;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("expected string");
  }
  return value;
}

function readNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("expected number");
  }
  return value;
}

export function parseAdminBroadcast(value: unknown): AdminBroadcastItem {
  const row = asRecord(value);
  if (!row) {
    throw new Error("broadcast is invalid");
  }
  const buttonRaw = asRecord(row.button);
  let button: AdminBroadcastItem["button"] = null;
  if (
    buttonRaw &&
    (buttonRaw.kind === "url" || buttonRaw.kind === "web_app") &&
    typeof buttonRaw.text === "string" &&
    typeof buttonRaw.url === "string"
  ) {
    button = {
      kind: buttonRaw.kind === "web_app" ? "web_app" : "url",
      text: buttonRaw.text,
      url: buttonRaw.url,
    };
  }
  return {
    id: readString(row.id),
    status: readString(row.status),
    messageText: readString(row.messageText),
    messagePreview:
      typeof row.messagePreview === "string"
        ? row.messagePreview
        : readString(row.messageText).slice(0, 50),
    hasPhoto: row.hasPhoto === true || Boolean(row.photoKey),
    photoUrl: typeof row.photoUrl === "string" ? row.photoUrl : null,
    button,
    recipientCount: readNumber(row.recipientCount),
    sentCount: readNumber(row.sentCount),
    failedCount: readNumber(row.failedCount),
    createdAt: readString(row.createdAt),
    startedAt: typeof row.startedAt === "string" ? row.startedAt : null,
    completedAt: typeof row.completedAt === "string" ? row.completedAt : null,
  };
}

export function parseAdminBroadcastList(value: unknown): {
  items: AdminBroadcastItem[];
} {
  const row = asRecord(value);
  if (!row || !Array.isArray(row.items)) {
    throw new Error("broadcast list is invalid");
  }
  return { items: row.items.map(parseAdminBroadcast) };
}

export function broadcastStatusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "В очереди";
    case "sending":
      return "Отправляется";
    case "completed":
      return "Рассылка завершена";
    case "completed_with_errors":
      return "Завершена с ошибками";
    case "failed":
      return "Ошибка";
    default:
      return status;
  }
}
