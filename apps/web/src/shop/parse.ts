import type {
  AdminShopOrder,
  ShopCatalogProduct,
  ShopCategory,
  ShopOrderStatus,
  ShopRequiredField,
} from "./shop-messages.js";
import { isRetiredShopProduct } from "./shop-messages.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("invalid string");
  }
  return value;
}

function readNullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return readString(value);
}

function readCategory(value: unknown): ShopCategory {
  if (
    value === "money" ||
    value === "donations" ||
    value === "subs" ||
    value === "other"
  ) {
    return value;
  }
  throw new Error("invalid shop category");
}

function readRequiredField(value: unknown): ShopRequiredField {
  if (
    value === "welvuraId" ||
    value === "slotName" ||
    value === "displayNickname" ||
    value === "donationText" ||
    value === "mediaUrl" ||
    value === "telegramUsername" ||
    value === "kickUsername" ||
    value === "gifUploadId"
  ) {
    return value;
  }
  throw new Error("invalid shop field");
}

function readStatus(value: unknown): ShopOrderStatus {
  if (
    value === "pending" ||
    value === "processing" ||
    value === "fulfilled" ||
    value === "rejected"
  ) {
    return value;
  }
  throw new Error("invalid shop status");
}

export function parseShopCatalog(value: unknown): { items: ShopCatalogProduct[] } {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("invalid shop catalog");
  }
  return {
    items: value.items
      .map((item) => {
        if (!isRecord(item) || !Array.isArray(item.requiredFields)) {
          throw new Error("invalid shop product");
        }
        if (item.fulfillmentType !== "manual" && item.fulfillmentType !== "instant") {
          throw new Error("invalid fulfillment type");
        }
        const fulfillmentType: "manual" | "instant" = item.fulfillmentType;
        return {
          code: readString(item.code),
          title: readString(item.title),
          category: readCategory(item.category),
          priceAzc: readString(item.priceAzc),
          fulfillmentType,
          requiredFields: item.requiredFields.map(readRequiredField),
          description: readString(item.description),
        };
      })
      .filter((item) => !isRetiredShopProduct(item)),
  };
}

export function parseAdminShopOrders(value: unknown): {
  items: AdminShopOrder[];
  nextCursor: string | null;
} {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("invalid admin shop orders");
  }
  return {
    items: value.items.map((item) => {
      if (!isRecord(item)) {
        throw new Error("invalid admin shop order");
      }
      const fulfillmentType = item.fulfillmentType;
      if (fulfillmentType !== "manual" && fulfillmentType !== "instant") {
        throw new Error("invalid fulfillment type");
      }
      const payload = isRecord(item.submittedPayload) ? item.submittedPayload : {};
      const submittedPayload: Record<string, string> = {};
      for (const [key, entry] of Object.entries(payload)) {
        if (typeof entry === "string") {
          submittedPayload[key] = entry;
        }
      }
      return {
        id: readString(item.id),
        user: readNullableString(item.user),
        productCode: readString(item.productCode),
        productName: readString(item.productName),
        priceAzc: readString(item.priceAzc),
        status: readStatus(item.status),
        submittedPayload,
        createdAt: readString(item.createdAt),
        processingAt: readNullableString(item.processingAt),
        fulfilledAt: readNullableString(item.fulfilledAt),
        rejectedAt: readNullableString(item.rejectedAt),
        rejectionReason: readNullableString(item.rejectionReason),
        processedByAdminId: readNullableString(item.processedByAdminId),
        fulfillmentType,
      };
    }),
    nextCursor: readNullableString(value.nextCursor),
  };
}
