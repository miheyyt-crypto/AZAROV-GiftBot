export const RETIRED_SHOP_PRODUCT_CODES = new Set(["premium-6", "premium-12"]);

export function isRetiredShopProduct(item: {
  code: string;
  title?: string;
}): boolean {
  if (RETIRED_SHOP_PRODUCT_CODES.has(item.code)) {
    return true;
  }
  return (item.title ?? "").toLowerCase().includes("telegram premium");
}

export type ShopRequiredField =
  | "welvuraId"
  | "slotName"
  | "displayNickname"
  | "donationText"
  | "mediaUrl"
  | "telegramUsername"
  | "kickUsername"
  | "gifUploadId";

export type ShopCategory = "money" | "donations" | "subs" | "other";
export type ShopOrderStatus = "pending" | "processing" | "fulfilled" | "rejected";

export type ShopCatalogProduct = {
  code: string;
  title: string;
  category: ShopCategory;
  priceAzc: string;
  fulfillmentType: "manual" | "instant";
  requiredFields: ShopRequiredField[];
  description: string;
};

export type ShopPurchaseResult = {
  status: ShopOrderStatus;
  orderId: string;
  productCode: string;
  priceAzc: string;
  newBalanceAzc: string;
  replayed?: boolean;
  inventoryGranted?: { type: "streak_freeze"; quantity: number };
};

export type AdminShopOrder = {
  id: string;
  user: string | null;
  productCode: string;
  productName: string;
  priceAzc: string;
  status: ShopOrderStatus;
  submittedPayload: Record<string, string>;
  createdAt: string;
  processingAt: string | null;
  fulfilledAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  processedByAdminId: string | null;
  fulfillmentType: "manual" | "instant";
};

export const SHOP_FIELD_LABEL: Record<ShopRequiredField, string> = {
  welvuraId: "Welvura ID",
  slotName: "Название слота",
  displayNickname: "Ник для доната",
  donationText: "Текст доната",
  mediaUrl: "YouTube или SoundCloud",
  telegramUsername: "Telegram username",
  kickUsername: "Kick username",
  gifUploadId: "Файл",
};

export function shopPayloadDetailLabel(key: string): string {
  if (key === "slotName") {
    return "Слот";
  }
  if (key in SHOP_FIELD_LABEL) {
    return SHOP_FIELD_LABEL[key as ShopRequiredField];
  }
  return key;
}

function usableShopServerMessage(message?: string): string | undefined {
  if (!message || message.startsWith("request failed:")) {
    return undefined;
  }
  return message;
}

export function friendlyShopError(code?: string, message?: string): string {
  switch (code) {
    case "SHOP_INSUFFICIENT_BALANCE":
      return "Недостаточно монет";
    case "SHOP_INVALID_WELVURA_ID":
      return "Некорректный Welvura ID";
    case "SHOP_INVALID_TELEGRAM_USERNAME":
      return "Некорректный Telegram username";
    case "SHOP_INVALID_KICK_USERNAME":
      return "Некорректный Kick username";
    case "SHOP_INVALID_DONATION_NICKNAME":
      return "Введите ник для доната";
    case "SHOP_INVALID_DONATION_TEXT":
      return "Введите текст доната";
    case "SHOP_INVALID_MEDIA_URL":
      return "Разрешены только YouTube или SoundCloud";
    case "SHOP_INVALID_SLOT_NAME":
      return "Введите название слота";
    case "SHOP_INVALID_GIF_UPLOAD":
      return "Загрузите файл заново";
    case "SHOP_STREAM_MEDIA_NEEDS_MODERATION":
      return "Это медиа на стрим: откройте модерацию и нажмите «Одобрить и отправить на стрим»";
    case "STREAM_GIF_INVALID_FILE":
    case "STREAM_MEDIA_CORRUPT":
      return "Не удалось прочитать файл";
    case "STREAM_MEDIA_TOO_LARGE":
      return "Файл больше 10 МБ";
    case "STREAM_MEDIA_UNSUPPORTED_FORMAT":
      return "Формат не поддерживается. Нужны JPG, PNG, WebP, GIF, MP4, MOV или WebM";
    case "STREAM_MEDIA_LIMIT":
      return usableShopServerMessage(message) ??
        "Файл слишком тяжёлый или слишком большого разрешения";
    case "STREAM_MEDIA_CODEC_UNSUPPORTED":
      return usableShopServerMessage(message) ??
        "Этот кодек OBS не воспроизведёт. Нужен H.264, VP8, VP9 или AV1";
    case "STREAM_GIF_UPLOAD_NOT_FOUND":
      return "Загрузите файл заново";
    case "STREAM_MEDIA_NOT_READY":
      return "Файл ещё готовится для показа. Подождите несколько секунд";
    case "SHOP_PRODUCT_UNAVAILABLE":
    case "SHOP_PRODUCT_NOT_FOUND":
      return "Товар недоступен";
    default:
      return "Не удалось оформить заказ";
  }
}

export function friendlyShopStatus(status: ShopOrderStatus): string {
  switch (status) {
    case "pending":
      return "В ожидании";
    case "processing":
      return "В обработке";
    case "fulfilled":
      return "Готово";
    case "rejected":
      return "Отклонено";
  }
}

export function clientShopValidationError(
  product: ShopCatalogProduct,
  fields: Record<string, string>,
): string | undefined {
  for (const field of product.requiredFields) {
    const value = (fields[field] ?? "").trim();
    if (field === "donationText") {
      if (value.length === 0) {
        return "Введите текст доната";
      }
      if (value.length > 300) {
        return "Слишком длинный текст";
      }
      continue;
    }
    if (field === "displayNickname") {
      if (value.length === 0 || value.length > 20) {
        return "Введите ник для доната";
      }
      continue;
    }
    if (field === "mediaUrl") {
      if (value.length === 0) {
        return "Разрешены только YouTube или SoundCloud";
      }
      try {
        const parsed = new URL(value);
        const host = parsed.hostname.toLowerCase();
        const youtube =
          host === "youtube.com" ||
          host === "www.youtube.com" ||
          host === "m.youtube.com" ||
          host === "youtu.be" ||
          host === "www.youtu.be" ||
          host === "music.youtube.com";
        const soundcloud =
          host === "soundcloud.com" ||
          host === "www.soundcloud.com" ||
          host.endsWith(".soundcloud.com");
        if (
          (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
          (!youtube && !soundcloud)
        ) {
          return "Разрешены только YouTube или SoundCloud";
        }
      } catch {
        return "Разрешены только YouTube или SoundCloud";
      }
      continue;
    }
    if (field === "slotName") {
      if (value.length === 0 || value.length > 80) {
        return "Введите название слота";
      }
      continue;
    }
    if (field === "gifUploadId") {
      if (value.length === 0) {
        return "Загрузите фото, GIF или видео";
      }
      continue;
    }
    if (value.length === 0) {
      if (field === "welvuraId") {
        return "Некорректный Welvura ID";
      }
      if (field === "telegramUsername") {
        return "Некорректный Telegram username";
      }
      if (field === "kickUsername") {
        return "Некорректный Kick username";
      }
    }
  }
  return undefined;
}
