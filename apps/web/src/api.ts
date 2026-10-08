import type { BootstrapPayload, MiniAppSectionId, SectionPayload } from "./types.js";
import { parseFreeCaseOpenResult } from "./free-case/parse.js";
import type { FreeCaseOpenResult } from "./free-case/types.js";
import { parsePaidCaseCatalog, parsePaidCaseOpenResult } from "./paid-case/parse.js";
import type { PaidCaseCatalog, PaidCaseOpenResult } from "./paid-case/types.js";
import {
  parseReferralCaseCatalog,
  parseReferralCaseOpenResult,
} from "./referral-case/parse.js";
import { parseBalanceLeaderboard, parseReferralLeaderboard } from "./leaderboard/parse.js";
import { parseContestHomeSummaryResponse } from "./contest/parse.js";
import { parseReferralList, parseReferralMe } from "./referrals/parse.js";
import {
  parseAdminWelvuraAccounts,
  parseAdminWelvuraDeposits,
  parseTasksResponse,
  parseWelvuraState,
} from "./tasks/parse.js";
import {
  parseActiveMines,
  parseDiceHistory,
  parseDicePlay,
  parseMinesReveal,
  parseMinesStart,
} from "./games/parse.js";
import {
  parseRollsBetResult,
  parseRollsCurrent,
  parseRollsHistory,
} from "./games/rolls-parse.js";
import type { DiceRound, MinesGame } from "./games/types.js";
import type { RollsCurrent, RollsHistoryItem, RollsRound } from "./games/rolls-types.js";
import { parseAchievementsResponse } from "./achievements/parse.js";
import type { AchievementsResponse } from "./achievements/types.js";
import {
  parseAdminGiveawayDetail,
  parseAdminGiveawaysList,
  parseGiveawayAdminListItem,
  parseGiveawaysList,
  parseJoinGiveawayResult,
} from "./giveaways/parse.js";
import type {
  GiveawayAdminDetail,
  GiveawayAdminListItem,
  GiveawayDbStatus,
  GiveawayTab,
  GiveawayType,
  GiveawaysListResponse,
  JoinGiveawayResult,
} from "./giveaways/types.js";
import {
  parseAdminBroadcast,
  parseAdminBroadcastList,
  type AdminBroadcastItem,
} from "./admin/broadcast-parse.js";
import {
  GET_RETRY_ATTEMPTS,
  isIdempotentRead,
  retryAfterMs,
  shouldRetryGetStatus,
  sleep,
} from "./http-retry.js";
import { dedupeGet } from "./get-dedup.js";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly nextAvailableAt?: string;

  constructor(
    status: number,
    message: string,
    code?: string,
    extras?: { nextAvailableAt?: string },
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    if (code) {
      this.code = code;
    }
    if (extras?.nextAvailableAt) {
      this.nextAvailableAt = extras.nextAvailableAt;
    }
  }
}

const FETCH_TIMEOUT_MS = 12_000;

async function fetchOnce(path: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(path, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = String(init.method ?? "GET");
  const retryReads = isIdempotentRead(method);
  const maxAttempts = retryReads ? GET_RETRY_ATTEMPTS + 1 : 1;
  let lastResponse: Response | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      const retryAfter =
        lastResponse?.status === 429
          ? lastResponse.headers.get("retry-after")
          : null;
      await sleep(retryAfterMs(retryAfter, attempt - 1));
    }
    try {
      const response = await fetchOnce(path, init);
      lastResponse = response;
      if (
        retryReads &&
        shouldRetryGetStatus(response.status) &&
        attempt < maxAttempts - 1
      ) {
        continue;
      }
      return response;
    } catch (error) {
      if (retryReads && attempt < maxAttempts - 1) {
        continue;
      }
      throw error;
    }
  }
  if (lastResponse) {
    return lastResponse;
  }
  throw new ApiRequestError(0, "request failed");
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let code: string | undefined;
    let message = `request failed: ${response.status}`;
    let nextAvailableAt: string | undefined;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object") {
        if (
          "error" in body &&
          typeof (body as { error: unknown }).error === "string"
        ) {
          code = (body as { error: string }).error;
        }
        if (
          "message" in body &&
          typeof (body as { message: unknown }).message === "string" &&
          (body as { message: string }).message.length > 0
        ) {
          message = (body as { message: string }).message;
        }
        if (
          "nextAvailableAt" in body &&
          typeof (body as { nextAvailableAt: unknown }).nextAvailableAt ===
            "string"
        ) {
          nextAvailableAt = (body as { nextAvailableAt: string })
            .nextAvailableAt;
        }
      }
    } catch {
      code = undefined;
    }
    throw new ApiRequestError(
      response.status,
      message,
      code,
      nextAvailableAt ? { nextAvailableAt } : undefined,
    );
  }
  return (await response.json()) as T;
}

export async function pingMiniAppPresence(token: string): Promise<void> {
  try {
    const response = await apiFetch("/auth/presence", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      return;
    }
  } catch {
    return;
  }
}

export async function authenticateTelegram(
  initData: string,
): Promise<{ token: string; expiresAt: string }> {
  const response = await apiFetch("/auth/telegram", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData }),
  });
  return readJson(response);
}

export async function authenticateDev(
  role: "user" | "admin",
): Promise<{
  token: string;
  expiresAt: string;
  role: "user" | "admin";
  adminToken?: string;
  adminExpiresAt?: string;
}> {
  let response: Response;
  try {
    response = await apiFetch("/dev/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    });
  } catch {
    throw new ApiRequestError(0, "local API unreachable");
  }
  return readJson(response);
}

export async function loadBootstrap(token: string): Promise<BootstrapPayload> {
  const response = await apiFetch("/bootstrap", {
    headers: { authorization: `Bearer ${token}` },
  });
  return readJson(response);
}

export async function startKickOAuth(
  token: string,
): Promise<{ authorizationUrl: string; expiresAt: string }> {
  const response = await apiFetch("/kick/oauth/start", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  return readJson(response);
}

export async function playGame(
  token: string,
  gameId: string,
  betAmountMinor: string,
  idempotencyKey: string,
): Promise<{ roundId: string; status: string }> {
  const response = await apiFetch(`/games/${gameId}/play`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({ betAmountMinor }),
  });
  return readJson(response);
}

export async function loadSection(
  token: string,
  section: MiniAppSectionId,
): Promise<SectionPayload> {
  const response = await apiFetch(`/sections/${section}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return readJson(response);
}

export async function loadJson<T>(
  token: string,
  path: string,
  parse: (value: unknown) => T,
): Promise<T> {
  return dedupeGet(token, path, async () => {
    const response = await apiFetch(path, {
      headers: { authorization: `Bearer ${token}` },
    });
    const json: unknown = await readJson(response);
    return parse(json);
  });
}

export type PromoRedeemResult = {
  status: "redeemed";
  rewardAzc: string;
  newBalanceAzc: string;
};

export async function redeemPromo(
  token: string,
  code: string,
  idempotencyKey: string,
): Promise<PromoRedeemResult> {
  const response = await apiFetch("/promo/redeem", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({ code }),
  });
  return readJson(response);
}

export async function authenticateAdmin(
  initData: string,
): Promise<{ token: string; expiresAt: string }> {
  const response = await apiFetch("/admin/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData }),
  });
  return readJson(response);
}

export type AdminPromoItem = {
  id: string;
  code: string;
  reward: string;
  used: number;
  limit: number;
  status: "active" | "inactive";
  createdAt: string;
  deactivatedAt: string | null;
};

export async function loadAdminPromoCodes(
  token: string,
): Promise<{ items: AdminPromoItem[]; nextCursor: string | null }> {
  const response = await apiFetch("/admin/promo-codes", {
    headers: { authorization: `Bearer ${token}` },
  });
  return readJson(response);
}

export async function createAdminPromoCode(
  token: string,
  input: { code: string; rewardAzc: string; activationLimit: number },
  idempotencyKey: string,
): Promise<AdminPromoItem> {
  const response = await apiFetch("/admin/promo-codes", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(input),
  });
  return readJson(response);
}

export async function deactivateAdminPromoCode(
  token: string,
  promoCodeId: string,
  idempotencyKey: string,
): Promise<AdminPromoItem> {
  const response = await apiFetch(
    `/admin/promo-codes/${promoCodeId}/deactivate`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": idempotencyKey,
      },
    },
  );
  return readJson(response);
}

export type GramWithdrawalItem = {
  id: string;
  amountGram: string;
  telegramUsername: string;
  status: "pending" | "processing" | "fulfilled" | "rejected";
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  processingAt: string | null;
  fulfilledAt: string | null;
  rejectedAt: string | null;
};

export async function createGramWithdrawal(
  token: string,
  telegramUsername: string,
  idempotencyKey: string,
): Promise<GramWithdrawalItem> {
  const response = await apiFetch("/gram/withdrawals", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({ telegramUsername }),
  });
  return readJson(response);
}

export type AdminGramWithdrawalItem = GramWithdrawalItem & {
  user: string | null;
  processedByAdminId: string | null;
};

export async function loadAdminGramWithdrawals(
  token: string,
  status?: "all" | "pending" | "processing" | "fulfilled" | "rejected",
): Promise<{ items: AdminGramWithdrawalItem[]; nextCursor: string | null }> {
  const query = status && status !== "all" ? `?status=${status}` : "";
  const response = await apiFetch(`/admin/gram-withdrawals${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return readJson(response);
}

export async function processAdminGramWithdrawal(
  token: string,
  withdrawalId: string,
  idempotencyKey: string,
): Promise<AdminGramWithdrawalItem> {
  const response = await apiFetch(
    `/admin/gram-withdrawals/${withdrawalId}/process`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": idempotencyKey,
      },
    },
  );
  return readJson(response);
}

export async function fulfillAdminGramWithdrawal(
  token: string,
  withdrawalId: string,
  idempotencyKey: string,
): Promise<AdminGramWithdrawalItem> {
  const response = await apiFetch(
    `/admin/gram-withdrawals/${withdrawalId}/fulfill`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": idempotencyKey,
      },
    },
  );
  return readJson(response);
}

export async function rejectAdminGramWithdrawal(
  token: string,
  withdrawalId: string,
  reason: string,
  idempotencyKey: string,
): Promise<AdminGramWithdrawalItem> {
  const response = await apiFetch(
    `/admin/gram-withdrawals/${withdrawalId}/reject`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({ reason }),
    },
  );
  return readJson(response);
}

export type CashWithdrawalItem = {
  id: string;
  inventoryItemId: string;
  amountRub: string;
  welvuraId: string;
  source: string;
  status: "pending" | "processing" | "fulfilled" | "rejected";
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  processingAt: string | null;
  fulfilledAt: string | null;
  rejectedAt: string | null;
  replayed?: boolean;
};

export async function createCashWithdrawal(
  token: string,
  itemId: string,
  welvuraId: string,
  idempotencyKey: string,
): Promise<CashWithdrawalItem> {
  const response = await apiFetch(`/inventory/cash/${itemId}/withdraw`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({ welvuraId }),
  });
  return readJson(response);
}

export async function loadCashWithdrawals(
  token: string,
): Promise<{ items: CashWithdrawalItem[]; nextCursor: string | null }> {
  const response = await apiFetch("/inventory/cash-withdrawals", {
    headers: { authorization: `Bearer ${token}` },
  });
  return readJson(response);
}

export type AdminCashWithdrawalItem = CashWithdrawalItem & {
  user: string | null;
  telegramUsername: string | null;
  processedByAdminId: string | null;
};

export async function loadAdminCashWithdrawals(
  token: string,
  status?: "all" | "pending" | "processing" | "fulfilled" | "rejected",
): Promise<{ items: AdminCashWithdrawalItem[]; nextCursor: string | null }> {
  const query = status && status !== "all" ? `?status=${status}` : "";
  const response = await apiFetch(`/admin/cash-withdrawals${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return readJson(response);
}

export async function processAdminCashWithdrawal(
  token: string,
  withdrawalId: string,
  idempotencyKey: string,
): Promise<AdminCashWithdrawalItem> {
  const response = await apiFetch(
    `/admin/cash-withdrawals/${withdrawalId}/process`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": idempotencyKey,
      },
    },
  );
  return readJson(response);
}

export async function fulfillAdminCashWithdrawal(
  token: string,
  withdrawalId: string,
  idempotencyKey: string,
): Promise<AdminCashWithdrawalItem> {
  const response = await apiFetch(
    `/admin/cash-withdrawals/${withdrawalId}/fulfill`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": idempotencyKey,
      },
    },
  );
  return readJson(response);
}

export async function rejectAdminCashWithdrawal(
  token: string,
  withdrawalId: string,
  reason: string,
  idempotencyKey: string,
): Promise<AdminCashWithdrawalItem> {
  const response = await apiFetch(
    `/admin/cash-withdrawals/${withdrawalId}/reject`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({ reason }),
    },
  );
  return readJson(response);
}

export type ShopCatalogItem = {
  code: string;
  title: string;
  category: "money" | "donations" | "subs" | "other";
  priceAzc: string;
  fulfillmentType: "manual" | "instant";
  requiredFields: string[];
  description: string;
};

export type ShopOrderResult = {
  status: "pending" | "processing" | "fulfilled" | "rejected";
  orderId: string;
  productCode: string;
  priceAzc: string;
  newBalanceAzc: string;
  replayed?: boolean;
  inventoryGranted?: { type: "streak_freeze"; quantity: number };
};

export type ShopGifUpload = {
  uploadId: string;
  width: number;
  height: number;
  frameCount: number;
  contentType?: string;
  durationMs?: number;
  playbackReady?: boolean;
  needsPrepare?: boolean;
  prepareError?: string | null;
};

export async function uploadShopGif(
  token: string,
  file: File,
): Promise<ShopGifUpload> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch("/shop/gif-uploads", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
        "x-content-type": file.type || "application/octet-stream",
      },
      body: file,
      signal: controller.signal,
    });
    return readJson(response);
  } finally {
    clearTimeout(timer);
  }
}

export async function getShopGifUpload(
  token: string,
  uploadId: string,
): Promise<ShopGifUpload> {
  const response = await apiFetch(`/shop/gif-uploads/${uploadId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return readJson(response);
}

export async function createShopOrder(
  token: string,
  productCode: string,
  submittedData: Record<string, string>,
  idempotencyKey: string,
): Promise<ShopOrderResult> {
  const response = await apiFetch("/shop/orders", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({ productCode, submittedData }),
  });
  return readJson(response);
}

export type AdminShopOrderItem = {
  id: string;
  user: string | null;
  productCode: string;
  productName: string;
  priceAzc: string;
  status: "pending" | "processing" | "fulfilled" | "rejected";
  submittedPayload: Record<string, string>;
  createdAt: string;
  processingAt: string | null;
  fulfilledAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  processedByAdminId: string | null;
  fulfillmentType: "manual" | "instant";
};

export async function loadAdminShopOrders(
  token: string,
  status?: "all" | "pending" | "processing" | "fulfilled" | "rejected",
  productCode?: string,
): Promise<{ items: AdminShopOrderItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (status && status !== "all") {
    params.set("status", status);
  }
  if (productCode) {
    params.set("productCode", productCode);
  }
  const query = params.toString();
  const response = await apiFetch(
    `/admin/shop/orders${query ? `?${query}` : ""}`,
    {
      headers: { authorization: `Bearer ${token}` },
    },
  );
  return readJson(response);
}

export async function processAdminShopOrder(
  token: string,
  orderId: string,
  idempotencyKey: string,
): Promise<AdminShopOrderItem> {
  const response = await apiFetch(`/admin/shop/orders/${orderId}/process`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": idempotencyKey,
    },
  });
  return readJson(response);
}

export async function fulfillAdminShopOrder(
  token: string,
  orderId: string,
  idempotencyKey: string,
): Promise<AdminShopOrderItem> {
  const response = await apiFetch(`/admin/shop/orders/${orderId}/fulfill`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": idempotencyKey,
    },
  });
  return readJson(response);
}

export async function rejectAdminShopOrder(
  token: string,
  orderId: string,
  reason: string,
  idempotencyKey: string,
): Promise<AdminShopOrderItem> {
  const response = await apiFetch(`/admin/shop/orders/${orderId}/reject`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({ reason }),
  });
  return readJson(response);
}

export async function openFreeCase(
  token: string,
  idempotencyKey: string,
): Promise<FreeCaseOpenResult> {
  const response = await apiFetch("/cases/free/open", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({}),
  });
  const json: unknown = await readJson(response);
  return parseFreeCaseOpenResult(json);
}

export async function loadPaidCases(token: string): Promise<PaidCaseCatalog[]> {
  return loadJson(token, "/cases/paid", parsePaidCaseCatalog);
}

export async function openPaidCase(
  token: string,
  caseCode: string,
  idempotencyKey: string,
): Promise<PaidCaseOpenResult> {
  const response = await apiFetch(`/cases/${caseCode}/open`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({}),
  });
  const json: unknown = await readJson(response);
  return parsePaidCaseOpenResult(json);
}

export async function loadReferralMe(token: string) {
  return loadJson(token, "/referrals/me", parseReferralMe);
}

export async function loadReferrals(token: string) {
  return loadJson(token, "/referrals", parseReferralList);
}

export async function loadReferralCaseCatalog(token: string) {
  return loadJson(token, "/cases/referral", parseReferralCaseCatalog);
}

export async function openReferralCase(
  token: string,
  idempotencyKey: string,
) {
  const response = await apiFetch("/cases/referral/open", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({}),
  });
  const json: unknown = await readJson(response);
  return parseReferralCaseOpenResult(json);
}

export async function loadBalanceLeaderboard(token: string) {
  return loadJson(token, "/leaderboard/balance", parseBalanceLeaderboard);
}

export async function loadReferralLeaderboard(token: string) {
  return loadJson(token, "/leaderboard/referrals", parseReferralLeaderboard);
}

export async function loadContestReferralSummary(token: string) {
  return loadJson(token, "/contest/referral/summary", parseContestHomeSummaryResponse);
}

export async function loadTasks(token: string) {
  return loadJson(token, "/tasks", parseTasksResponse);
}

export async function claimTask(
  token: string,
  taskCode: string,
  idempotencyKey: string,
) {
  const response = await apiFetch(`/tasks/${encodeURIComponent(taskCode)}/claim`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({}),
  });
  return readJson<{
    taskCode: string;
    rewardAzc: string;
    completedAt: string;
    balances: { azc: string };
    replayed: boolean;
  }>(response);
}

export async function loadWelvura(token: string) {
  return loadJson(token, "/welvura", parseWelvuraState);
}

export async function submitWelvuraAccount(
  token: string,
  input: {
    welvuraId: string;
    contentType: string;
    screenshotBase64: string;
    originalFilename?: string;
  },
  idempotencyKey: string,
) {
  const response = await apiFetch("/welvura/account/submissions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(input),
  });
  return readJson<{
    submissionId: string;
    status: string;
    attemptNumber: number;
  }>(response);
}

export async function submitWelvuraStage(
  token: string,
  stageNumber: number,
  input: {
    contentType: string;
    screenshotBase64: string;
    originalFilename?: string;
  },
  idempotencyKey: string,
) {
  const response = await apiFetch(
    `/welvura/stages/${stageNumber}/submissions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(input),
    },
  );
  return readJson<{
    submissionId: string;
    stageNumber: number;
    status: string;
    attemptNumber: number;
  }>(response);
}

export async function postDevTaskEvidence(
  token: string,
  body: Record<string, unknown>,
) {
  const response = await apiFetch("/dev/tasks/evidence", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return readJson<{ ok: true }>(response);
}

export async function loadAdminWelvuraAccounts(
  adminToken: string,
  status: string,
) {
  return loadJson(
    adminToken,
    `/admin/welvura/account-submissions?status=${encodeURIComponent(status)}`,
    parseAdminWelvuraAccounts,
  );
}

export async function loadAdminWelvuraDeposits(
  adminToken: string,
  status: string,
) {
  return loadJson(
    adminToken,
    `/admin/welvura/deposit-submissions?status=${encodeURIComponent(status)}`,
    parseAdminWelvuraDeposits,
  );
}

export async function approveAdminWelvuraAccount(
  adminToken: string,
  id: string,
  idempotencyKey: string,
) {
  const response = await apiFetch(
    `/admin/welvura/account-submissions/${encodeURIComponent(id)}/approve`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({}),
    },
  );
  return readJson(response);
}

export async function rejectAdminWelvuraAccount(
  adminToken: string,
  id: string,
  reason: string,
  idempotencyKey: string,
) {
  const response = await apiFetch(
    `/admin/welvura/account-submissions/${encodeURIComponent(id)}/reject`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({ reason }),
    },
  );
  return readJson(response);
}

export async function approveAdminWelvuraDeposit(
  adminToken: string,
  id: string,
  idempotencyKey: string,
) {
  const response = await apiFetch(
    `/admin/welvura/deposit-submissions/${encodeURIComponent(id)}/approve`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({}),
    },
  );
  return readJson(response);
}

export async function rejectAdminWelvuraDeposit(
  adminToken: string,
  id: string,
  reason: string,
  idempotencyKey: string,
) {
  const response = await apiFetch(
    `/admin/welvura/deposit-submissions/${encodeURIComponent(id)}/reject`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({ reason }),
    },
  );
  return readJson(response);
}

export async function loadAdminWelvuraFileBlob(
  adminToken: string,
  fileId: string,
): Promise<string> {
  const response = await apiFetch(
    `/admin/welvura/files/${encodeURIComponent(fileId)}`,
    {
      headers: { authorization: `Bearer ${adminToken}` },
    },
  );
  if (!response.ok) {
    throw new ApiRequestError(response.status, `request failed: ${response.status}`);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export async function loadActiveMines(
  token: string,
): Promise<{ game: MinesGame | null }> {
  return loadJson(token, "/games/mines/active", parseActiveMines);
}

export async function startMines(
  token: string,
  input: { betAzc: number; mines: number; clientSeed: string },
  idempotencyKey: string,
): Promise<{ game: MinesGame; replayed: boolean }> {
  const response = await apiFetch("/games/mines/start", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(input),
  });
  return parseMinesStart(await readJson(response));
}

export async function revealMinesCellApi(
  token: string,
  gameId: string,
  cell: number,
  idempotencyKey: string,
): Promise<{ game: MinesGame; hitMine: boolean }> {
  const response = await apiFetch(
    `/games/mines/${encodeURIComponent(gameId)}/reveal`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({ cell }),
    },
  );
  return parseMinesReveal(await readJson(response));
}

export async function cashoutMinesApi(
  token: string,
  gameId: string,
  idempotencyKey: string,
): Promise<{ game: MinesGame; replayed: boolean }> {
  const response = await apiFetch(
    `/games/mines/${encodeURIComponent(gameId)}/cashout`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({}),
    },
  );
  return parseMinesStart(await readJson(response));
}

export async function playDiceApi(
  token: string,
  input: { betAzc: number; chance: number; clientSeed: string },
  idempotencyKey: string,
): Promise<{ round: DiceRound; replayed: boolean }> {
  const response = await apiFetch("/games/dice/play", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(input),
  });
  return parseDicePlay(await readJson(response));
}

export async function loadDiceHistory(
  token: string,
): Promise<{ items: DiceRound[]; nextCursor: string | null }> {
  return loadJson(token, "/games/dice/history", parseDiceHistory);
}

export async function loadRollsCurrent(token: string): Promise<RollsCurrent> {
  return loadJson(token, "/games/rolls/current", parseRollsCurrent);
}

export async function placeRollsBetApi(
  token: string,
  input: { amountAzc: number; clientSeed: string },
  idempotencyKey: string,
): Promise<{
  round: RollsRound;
  you: { stakeAzc: string; chancePercent: string; participantId: string | null };
  replayed: boolean;
}> {
  const response = await apiFetch("/games/rolls/bet", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(input),
  });
  return parseRollsBetResult(await readJson(response));
}

export async function loadRollsHistory(
  token: string,
): Promise<{ items: RollsHistoryItem[]; nextCursor: string | null }> {
  return loadJson(token, "/games/rolls/history", parseRollsHistory);
}

export async function loadRollsProvablyFair(
  token: string,
  roundId: string,
): Promise<Record<string, unknown>> {
  return loadJson(
    token,
    `/games/rolls/${encodeURIComponent(roundId)}/provably-fair`,
    (value) => {
      if (!value || typeof value !== "object") {
        throw new Error("invalid rolls pf");
      }
      return value as Record<string, unknown>;
    },
  );
}

export async function loadGiveaways(
  token: string,
  tab: GiveawayTab = "active",
): Promise<GiveawaysListResponse> {
  return loadJson(
    token,
    `/giveaways?tab=${encodeURIComponent(tab)}`,
    parseGiveawaysList,
  );
}

export async function joinGiveawayApi(
  token: string,
  giveawayId: string,
  idempotencyKey: string,
): Promise<JoinGiveawayResult> {
  const response = await apiFetch(
    `/giveaways/${encodeURIComponent(giveawayId)}/join`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({}),
    },
  );
  return parseJoinGiveawayResult(await readJson(response));
}

export async function loadAchievements(
  token: string,
): Promise<AchievementsResponse> {
  return loadJson(token, "/achievements", parseAchievementsResponse);
}

export async function loadAdminGiveaways(
  token: string,
  query: { status?: GiveawayDbStatus | "all"; cursor?: string } = {},
): Promise<{ items: GiveawayAdminListItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (query.status) {
    params.set("status", query.status);
  }
  if (query.cursor) {
    params.set("cursor", query.cursor);
  }
  const qs = params.toString();
  const response = await apiFetch(
    qs ? `/admin/giveaways?${qs}` : "/admin/giveaways",
    { headers: { authorization: `Bearer ${token}` } },
  );
  return parseAdminGiveawaysList(await readJson(response));
}

export async function loadAdminGiveawayDetail(
  token: string,
  giveawayId: string,
): Promise<GiveawayAdminDetail> {
  const response = await apiFetch(
    `/admin/giveaways/${encodeURIComponent(giveawayId)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  return parseAdminGiveawayDetail(await readJson(response));
}

export async function createAdminGiveaway(
  token: string,
  input: {
    title: string;
    type: GiveawayType;
    bankAzc?: string;
    customPrize?: string;
    winnerCount: number;
    endsAt?: string;
    imageUrl?: string | null;
    reason: string;
  },
  idempotencyKey: string,
): Promise<GiveawayAdminListItem> {
  const response = await apiFetch("/admin/giveaways", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(input),
  });
  return parseGiveawayAdminListItem(await readJson(response));
}

export async function patchAdminGiveaway(
  token: string,
  giveawayId: string,
  input: {
    title?: string;
    type?: GiveawayType;
    bankAzc?: string | null;
    customPrize?: string | null;
    winnerCount?: number;
    endsAt?: string | null;
    imageUrl?: string | null;
    reason: string;
  },
  idempotencyKey: string,
): Promise<GiveawayAdminListItem> {
  const response = await apiFetch(
    `/admin/giveaways/${encodeURIComponent(giveawayId)}`,
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(input),
    },
  );
  return parseGiveawayAdminListItem(await readJson(response));
}

export async function uploadAdminGiveawayImage(
  token: string,
  input: { contentType: string; imageBase64: string },
): Promise<{ imageUrl: string }> {
  const response = await apiFetch("/admin/giveaways/media", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const body = await readJson(response);
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { imageUrl?: unknown }).imageUrl !== "string"
  ) {
    throw new Error("invalid giveaway image upload");
  }
  return { imageUrl: (body as { imageUrl: string }).imageUrl };
}

export async function activateAdminGiveaway(
  token: string,
  giveawayId: string,
  reason: string,
  idempotencyKey: string,
): Promise<GiveawayAdminListItem> {
  const response = await apiFetch(
    `/admin/giveaways/${encodeURIComponent(giveawayId)}/activate`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({ reason }),
    },
  );
  return parseGiveawayAdminListItem(await readJson(response));
}

export async function cancelAdminGiveaway(
  token: string,
  giveawayId: string,
  reason: string,
  idempotencyKey: string,
): Promise<GiveawayAdminListItem> {
  const response = await apiFetch(
    `/admin/giveaways/${encodeURIComponent(giveawayId)}/cancel`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({ reason }),
    },
  );
  return parseGiveawayAdminListItem(await readJson(response));
}

export async function deliverAdminGiveawayWinner(
  token: string,
  giveawayId: string,
  winnerUserId: string,
  reason: string,
  idempotencyKey: string,
): Promise<{ winnerId: string; replayed: boolean }> {
  const response = await apiFetch(
    `/admin/giveaways/${encodeURIComponent(giveawayId)}/winners/${encodeURIComponent(winnerUserId)}/deliver`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({ reason }),
    },
  );
  const body = await readJson<{ winnerId: string; replayed?: boolean }>(response);
  return {
    winnerId: body.winnerId,
    replayed: body.replayed === true,
  };
}

export async function loadAdminBroadcastMeta(
  token: string,
): Promise<{ recipientCount: number }> {
  const response = await apiFetch("/admin/broadcasts/meta", {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await readJson(response);
  const count = (body as { recipientCount?: unknown }).recipientCount;
  if (typeof count !== "number") {
    throw new Error("invalid broadcast meta");
  }
  return { recipientCount: count };
}

export async function loadAdminBroadcasts(
  token: string,
): Promise<{ items: AdminBroadcastItem[] }> {
  const response = await apiFetch("/admin/broadcasts", {
    headers: { authorization: `Bearer ${token}` },
  });
  return parseAdminBroadcastList(await readJson(response));
}

export async function loadAdminBroadcast(
  token: string,
  id: string,
): Promise<AdminBroadcastItem> {
  const response = await apiFetch(`/admin/broadcasts/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return parseAdminBroadcast(await readJson(response));
}

export async function createAdminBroadcast(
  token: string,
  input: {
    messageText: string;
    photoKey?: string;
    button?: { kind: "url" | "web_app"; text: string; url: string };
  },
  idempotencyKey: string,
): Promise<AdminBroadcastItem> {
  const response = await apiFetch("/admin/broadcasts", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(input),
  });
  return parseAdminBroadcast(await readJson(response));
}

export async function uploadAdminBroadcastImage(
  token: string,
  input: { contentType: string; imageBase64: string },
): Promise<{ photoKey: string; imageUrl: string }> {
  const response = await apiFetch("/admin/broadcasts/media", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const body = await readJson(response);
  const photoKey = (body as { photoKey?: unknown }).photoKey;
  const imageUrl = (body as { imageUrl?: unknown }).imageUrl;
  if (typeof photoKey !== "string" || typeof imageUrl !== "string") {
    throw new Error("invalid broadcast image upload");
  }
  return { photoKey, imageUrl };
}

export type StreamDonationItem = {
  id: string;
  displayName: string;
  message: string;
  amountAzc: string;
  status: "queued" | "playing" | "finished";
  createdAt: string;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type StreamGifAdminItem = {
  id: string;
  userId: string;
  publicId: string | null;
  displayName: string | null;
  orderId: string | null;
  donationId: string | null;
  status:
    | "pending_moderation"
    | "queued"
    | "playing"
    | "shown"
    | "rejected";
  playbackOutcome: string | null;
  width: number;
  height: number;
  frameCount: number;
  durationMs?: number;
  contentType?: string;
  playbackReady?: boolean;
  createdAt: string;
  rejectionReason: string | null;
};

export async function loadAdminStreamGifs(
  token: string,
): Promise<{ items: StreamGifAdminItem[] }> {
  const response = await apiFetch("/admin/stream-gifs", {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await readJson(response);
  const items = (body as { items?: unknown }).items;
  return { items: Array.isArray(items) ? (items as StreamGifAdminItem[]) : [] };
}

export async function loadAdminStreamGifBlob(
  token: string,
  id: string,
): Promise<string> {
  const response = await apiFetch(`/admin/stream-gifs/${id}/media`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    await readJson(response);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export type ApproveAdminStreamGifResult = {
  enqueued: boolean;
  replayed: boolean;
  item: {
    id: string;
    status: StreamGifAdminItem["status"];
    orderId: string | null;
    donationId: string | null;
  };
};

export async function approveAdminStreamGif(
  token: string,
  id: string,
  idempotencyKey: string,
): Promise<ApproveAdminStreamGifResult> {
  const response = await apiFetch(`/admin/stream-gifs/${id}/approve`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({}),
  });
  const body = await readJson<{
    enqueued?: unknown;
    replayed?: unknown;
    item?: {
      id?: unknown;
      status?: unknown;
      orderId?: unknown;
      donationId?: unknown;
    };
  }>(response);
  const status = body.item?.status;
  const playbackStatus =
    status === "queued" || status === "playing" || status === "shown"
      ? status
      : undefined;
  if (
    typeof body.enqueued !== "boolean" ||
    typeof body.replayed !== "boolean" ||
    typeof body.item?.id !== "string" ||
    playbackStatus === undefined ||
    (!body.enqueued && !body.replayed)
  ) {
    throw new ApiRequestError(
      response.status,
      "approve did not enqueue",
      "STREAM_GIF_NOT_ENQUEUED",
    );
  }
  return {
    enqueued: body.enqueued,
    replayed: body.replayed,
    item: {
      id: body.item.id,
      status: playbackStatus,
      orderId: typeof body.item.orderId === "string" ? body.item.orderId : null,
      donationId:
        typeof body.item.donationId === "string" ? body.item.donationId : null,
    },
  };
}

export async function rejectAdminStreamGif(
  token: string,
  id: string,
  reason: string,
  idempotencyKey: string,
): Promise<void> {
  const response = await apiFetch(`/admin/stream-gifs/${id}/reject`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({ reason }),
  });
  await readJson(response);
}

export async function dismissPlayingStreamGif(token: string): Promise<void> {
  await apiFetch("/admin/stream-gifs/dismiss-playing", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });
}

export async function loadAdminStreamDonations(
  token: string,
): Promise<{ items: StreamDonationItem[] }> {
  const response = await apiFetch("/admin/stream-donations", {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await readJson(response);
  const items = (body as { items?: unknown }).items;
  return { items: Array.isArray(items) ? (items as StreamDonationItem[]) : [] };
}
