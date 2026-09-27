import type {
  AdminCashItemWithdrawal,
  AdminGramWithdrawal,
  CashItemWithdrawal,
  CashItemWithdrawalStatus,
  GramWithdrawal,
  GramWithdrawalStatus,
  ProfileInventoryItem,
  ProfileLedgerEntry,
  ProfileList,
  ProfileNotification,
  ProfileOrder,
  ProfileSummary,
} from "./types.js";

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

function readNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("invalid number");
  }
  return value;
}

function readBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error("invalid boolean");
  }
  return value;
}

function parseGramSummary(
  value: unknown,
  fallbackAvailable: string,
): ProfileSummary["gram"] {
  if (!isRecord(value)) {
    return {
      balance: fallbackAvailable,
      reserved: "0",
      available: fallbackAvailable,
      minimumWithdrawal: "20",
      canWithdraw: false,
    };
  }
  return {
    balance: readString(value.balance),
    reserved: readString(value.reserved),
    available: readString(value.available),
    minimumWithdrawal: readString(value.minimumWithdrawal),
    canWithdraw: readBoolean(value.canWithdraw),
  };
}

export function parseProfileSummary(value: unknown): ProfileSummary {
  if (!isRecord(value)) {
    throw new Error("invalid profile summary");
  }
  const user = isRecord(value.user) ? value.user : undefined;
  const balances = isRecord(value.balances) ? value.balances : undefined;
  const level = isRecord(value.level) ? value.level : undefined;
  const activity = isRecord(value.activity) ? value.activity : undefined;
  const integrations = isRecord(value.integrations) ? value.integrations : undefined;
  const kick = isRecord(integrations?.kick) ? integrations.kick : undefined;
  const welvura = isRecord(integrations?.welvura) ? integrations.welvura : undefined;
  const notifications = isRecord(value.notifications) ? value.notifications : undefined;
  const inventory = isRecord(value.inventory) ? value.inventory : undefined;
  const welvuraStatus = welvura?.status;
  if (
    welvuraStatus !== "not_linked" &&
    welvuraStatus !== "pending" &&
    welvuraStatus !== "approved" &&
    welvuraStatus !== "rejected"
  ) {
    throw new Error("invalid welvura status");
  }
  if (!user || !balances || !level || !activity || !kick || !welvura || !notifications || !inventory) {
    throw new Error("invalid profile summary");
  }
  return {
    user: {
      id: readString(user.id),
      telegramUsername: readNullableString(user.telegramUsername),
      telegramFirstName: readNullableString(user.telegramFirstName),
      telegramLastName: readNullableString(user.telegramLastName),
      displayName: readNullableString(user.displayName),
      avatarUrl: readNullableString(user.avatarUrl),
    },
    balances: {
      azc: readString(balances.azc),
      gram: readString(balances.gram),
    },
    gram: parseGramSummary(value.gram, readString(balances.gram)),
    level: {
      current: readNumber(level.current),
      totalXp: readString(level.totalXp),
      currentLevelXp: readString(level.currentLevelXp),
      nextLevelXp: readNullableString(level.nextLevelXp),
      xpNeededForNext: readNullableString(level.xpNeededForNext),
      progressRatio: readNumber(level.progressRatio),
      nextRewardAzc: readNullableString(level.nextRewardAzc),
    },
    activity: {
      kickChatMessages: readString(activity.kickChatMessages),
    },
    integrations: {
      kick: {
        linked: readBoolean(kick.linked),
        username: readNullableString(kick.username),
        displayName:
          kick.displayName === undefined ? null : readNullableString(kick.displayName),
        avatarUrl:
          kick.avatarUrl === undefined ? null : readNullableString(kick.avatarUrl),
      },
      welvura: {
        status: welvuraStatus,
        id: readNullableString(welvura.id),
      },
    },
    notifications: {
      unreadCount: readNumber(notifications.unreadCount),
    },
    inventory: {
      itemCount: readNumber(inventory.itemCount),
      streakFreezeCount: readNumber(inventory.streakFreezeCount),
    },
  };
}

function parseList<T>(value: unknown, parseItem: (item: unknown) => T): ProfileList<T> {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("invalid list");
  }
  return {
    items: value.items.map(parseItem),
    nextCursor: readNullableString(value.nextCursor),
  };
}

export function parseProfileNotifications(value: unknown): ProfileList<ProfileNotification> {
  return parseList(value, (item) => {
    if (!isRecord(item)) {
      throw new Error("invalid notification");
    }
    return {
      id: readString(item.id),
      type: readString(item.type),
      title: readString(item.title),
      body: readString(item.body),
      createdAt: readString(item.createdAt),
      readAt: readNullableString(item.readAt),
    };
  });
}

export function parseProfileLedger(value: unknown): ProfileList<ProfileLedgerEntry> {
  return parseList(value, (item) => {
    if (!isRecord(item)) {
      throw new Error("invalid ledger row");
    }
    return {
      id: readString(item.id),
      type: readString(item.type),
      label: readString(item.label),
      delta: readString(item.delta),
      balanceAfter: readString(item.balanceAfter),
      createdAt: readString(item.createdAt),
    };
  });
}

export function parseProfileInventory(value: unknown): ProfileList<ProfileInventoryItem> {
  return parseList(value, (item) => {
    if (!isRecord(item)) {
      throw new Error("invalid inventory item");
    }
    if (item.type === "streak_freeze") {
      return {
        type: "streak_freeze",
        id: readString(item.id),
        quantity: readNumber(item.quantity),
        status: readInventoryStatus(item.status),
      };
    }
    if (item.type === "external_prize") {
      return {
        type: "external_prize",
        id: readString(item.id),
        itemCode: readString(item.itemCode),
        title: readString(item.title),
        source: readString(item.source),
        status: readInventoryStatus(item.status),
      };
    }
    if (item.type !== "cash_rub") {
      throw new Error("invalid inventory type");
    }
    const activeRaw = item.activeWithdrawal;
    let activeWithdrawal: {
      id: string;
      status: CashItemWithdrawalStatus;
      welvuraId: string;
      createdAt: string;
    } | null = null;
    if (activeRaw !== null && activeRaw !== undefined) {
      if (!isRecord(activeRaw)) {
        throw new Error("invalid active withdrawal");
      }
      const activeStatus = activeRaw.status;
      if (
        activeStatus !== "pending" &&
        activeStatus !== "processing" &&
        activeStatus !== "fulfilled" &&
        activeStatus !== "rejected"
      ) {
        throw new Error("invalid active withdrawal status");
      }
      activeWithdrawal = {
        id: readString(activeRaw.id),
        status: activeStatus,
        welvuraId: readString(activeRaw.welvuraId),
        createdAt: readString(activeRaw.createdAt),
      };
    }
    return {
      type: "cash_rub",
      id: readString(item.id),
      amountRub: readString(item.amountRub),
      source: readString(item.source),
      status: readInventoryStatus(item.status),
      activeWithdrawal,
    };
  });
}

function readInventoryStatus(value: unknown): "available" | "reserved" | "consumed" {
  if (value === "available" || value === "reserved" || value === "consumed") {
    return value;
  }
  throw new Error("invalid inventory status");
}

export function parseProfileOrders(value: unknown): ProfileList<ProfileOrder> {
  return parseList(value, (item) => {
    if (!isRecord(item)) {
      throw new Error("invalid order");
    }
    const status = item.status;
    if (
      status !== "pending" &&
      status !== "processing" &&
      status !== "fulfilled" &&
      status !== "rejected"
    ) {
      throw new Error("invalid order status");
    }
    const preview = isRecord(item.submittedPreview) ? item.submittedPreview : {};
    const submittedPreview: Record<string, string> = {};
    for (const [key, entry] of Object.entries(preview)) {
      if (typeof entry === "string") {
        submittedPreview[key] = entry;
      }
    }
    return {
      id: readString(item.id),
      productCode: readString(item.productCode),
      productName: readString(item.productName),
      priceAzc: readString(item.priceAzc),
      status,
      createdAt: readString(item.createdAt),
      updatedAt: readString(item.updatedAt),
      rejectionReason: readNullableString(item.rejectionReason),
      submittedPreview,
    };
  });
}

function readGramStatus(value: unknown): GramWithdrawalStatus {
  if (
    value === "pending" ||
    value === "processing" ||
    value === "fulfilled" ||
    value === "rejected"
  ) {
    return value;
  }
  throw new Error("invalid gram withdrawal status");
}

function parseGramWithdrawal(item: unknown): GramWithdrawal {
  if (!isRecord(item)) {
    throw new Error("invalid gram withdrawal");
  }
  return {
    id: readString(item.id),
    amountGram: readString(item.amountGram),
    telegramUsername: readString(item.telegramUsername),
    status: readGramStatus(item.status),
    rejectionReason: readNullableString(item.rejectionReason),
    createdAt: readString(item.createdAt),
    updatedAt: readString(item.updatedAt),
    processingAt: readNullableString(item.processingAt),
    fulfilledAt: readNullableString(item.fulfilledAt),
    rejectedAt: readNullableString(item.rejectedAt),
  };
}

export function parseGramWithdrawals(value: unknown): ProfileList<GramWithdrawal> {
  return parseList(value, parseGramWithdrawal);
}

export function parseAdminGramWithdrawals(
  value: unknown,
): ProfileList<AdminGramWithdrawal> {
  return parseList(value, (item) => {
    const base = parseGramWithdrawal(item);
    if (!isRecord(item)) {
      throw new Error("invalid gram withdrawal");
    }
    return {
      ...base,
      user: readNullableString(item.user),
      processedByAdminId: readNullableString(item.processedByAdminId),
    };
  });
}

function readCashStatus(value: unknown): CashItemWithdrawalStatus {
  if (
    value === "pending" ||
    value === "processing" ||
    value === "fulfilled" ||
    value === "rejected"
  ) {
    return value;
  }
  throw new Error("invalid cash withdrawal status");
}

function parseCashWithdrawal(item: unknown): CashItemWithdrawal {
  if (!isRecord(item)) {
    throw new Error("invalid cash withdrawal");
  }
  return {
    id: readString(item.id),
    inventoryItemId: readString(item.inventoryItemId),
    amountRub: readString(item.amountRub),
    welvuraId: readString(item.welvuraId),
    source: readString(item.source),
    status: readCashStatus(item.status),
    rejectionReason: readNullableString(item.rejectionReason),
    createdAt: readString(item.createdAt),
    updatedAt: readString(item.updatedAt),
    processingAt: readNullableString(item.processingAt),
    fulfilledAt: readNullableString(item.fulfilledAt),
    rejectedAt: readNullableString(item.rejectedAt),
  };
}

export function parseCashWithdrawals(
  value: unknown,
): ProfileList<CashItemWithdrawal> {
  return parseList(value, parseCashWithdrawal);
}

export function parseAdminCashWithdrawals(
  value: unknown,
): ProfileList<AdminCashItemWithdrawal> {
  return parseList(value, (item) => {
    const base = parseCashWithdrawal(item);
    if (!isRecord(item)) {
      throw new Error("invalid cash withdrawal");
    }
    return {
      ...base,
      user: readNullableString(item.user),
      telegramUsername: readNullableString(item.telegramUsername),
      processedByAdminId: readNullableString(item.processedByAdminId),
    };
  });
}
