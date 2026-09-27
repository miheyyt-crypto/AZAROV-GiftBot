export type ProfileSummary = {
  user: {
    id: string;
    telegramUsername: string | null;
    telegramFirstName: string | null;
    telegramLastName: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  balances: {
    azc: string;
    gram: string;
  };
  gram: {
    balance: string;
    reserved: string;
    available: string;
    minimumWithdrawal: string;
    canWithdraw: boolean;
  };
  level: {
    current: number;
    totalXp: string;
    currentLevelXp: string;
    nextLevelXp: string | null;
    xpNeededForNext: string | null;
    progressRatio: number;
    nextRewardAzc: string | null;
  };
  activity: {
    kickChatMessages: string;
  };
  integrations: {
    kick: {
      linked: boolean;
      username: string | null;
      displayName: string | null;
      avatarUrl: string | null;
    };
    welvura: {
      status: "not_linked" | "pending" | "approved" | "rejected";
      id: string | null;
    };
  };
  notifications: {
    unreadCount: number;
  };
  inventory: {
    itemCount: number;
    streakFreezeCount: number;
  };
};

export type ProfileNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
};

export type ProfileLedgerEntry = {
  id: string;
  type: string;
  label: string;
  delta: string;
  balanceAfter: string;
  createdAt: string;
};

export type ProfileInventoryItem =
  | {
      type: "cash_rub";
      id: string;
      amountRub: string;
      source: string;
      status: "available" | "reserved" | "consumed";
      activeWithdrawal: {
        id: string;
        status: CashItemWithdrawalStatus;
        welvuraId: string;
        createdAt: string;
      } | null;
    }
  | {
      type: "streak_freeze";
      id: string;
      quantity: number;
      status: "available" | "reserved" | "consumed";
    }
  | {
      type: "external_prize";
      id: string;
      itemCode: string;
      title: string;
      source: string;
      status: "available" | "reserved" | "consumed";
    };

export type ProfileOrder = {
  id: string;
  productCode: string;
  productName: string;
  priceAzc: string;
  status: "pending" | "processing" | "fulfilled" | "rejected";
  createdAt: string;
  updatedAt: string;
  rejectionReason: string | null;
  submittedPreview: Record<string, string>;
};

export type GramWithdrawalStatus = "pending" | "processing" | "fulfilled" | "rejected";

export type CashItemWithdrawalStatus =
  | "pending"
  | "processing"
  | "fulfilled"
  | "rejected";

export type CashItemWithdrawal = {
  id: string;
  inventoryItemId: string;
  amountRub: string;
  welvuraId: string;
  source: string;
  status: CashItemWithdrawalStatus;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  processingAt: string | null;
  fulfilledAt: string | null;
  rejectedAt: string | null;
};

export type AdminCashItemWithdrawal = CashItemWithdrawal & {
  user: string | null;
  telegramUsername: string | null;
  processedByAdminId: string | null;
};

export type GramWithdrawal = {
  id: string;
  amountGram: string;
  telegramUsername: string;
  status: GramWithdrawalStatus;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  processingAt: string | null;
  fulfilledAt: string | null;
  rejectedAt: string | null;
};

export type AdminGramWithdrawal = GramWithdrawal & {
  user: string | null;
  processedByAdminId: string | null;
};

export type ProfileList<T> = {
  items: T[];
  nextCursor: string | null;
};

export const EMPTY_PROFILE_SUMMARY: ProfileSummary = {
  user: {
    id: "00000000-0000-0000-0000-000000000000",
    telegramUsername: null,
    telegramFirstName: null,
    telegramLastName: null,
    displayName: null,
    avatarUrl: null,
  },
  balances: { azc: "0", gram: "0" },
  gram: {
    balance: "0",
    reserved: "0",
    available: "0",
    minimumWithdrawal: "20",
    canWithdraw: false,
  },
  level: {
    current: 1,
    totalXp: "0",
    currentLevelXp: "0",
    nextLevelXp: "200",
    xpNeededForNext: "200",
    progressRatio: 0,
    nextRewardAzc: "100",
  },
  activity: { kickChatMessages: "0" },
  integrations: {
    kick: { linked: false, username: null, displayName: null, avatarUrl: null },
    welvura: { status: "not_linked", id: null },
  },
  notifications: { unreadCount: 0 },
  inventory: { itemCount: 0, streakFreezeCount: 0 },
};

export const EMPTY_PROFILE_LIST: {
  items: never[];
  nextCursor: null;
} = {
  items: [],
  nextCursor: null,
};
