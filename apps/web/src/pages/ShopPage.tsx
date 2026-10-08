import { useEffect, useState } from "react";
import {
  ApiRequestError,
  createShopOrder,
  loadJson,
  loadReferralCaseCatalog,
  openPaidCase,
  openReferralCase,
  uploadShopGif,
} from "../api.js";
import { navigate } from "../app/routes.js";
import { QueryPanel } from "../components/QueryPanel.js";
import { clearIdempotencyKey, keyForPost } from "../idempotency.js";
import { friendlyPaidCaseError } from "../paid-case/messages.js";
import { parsePaidCaseCatalog } from "../paid-case/parse.js";
import type {
  PaidCaseCatalog,
  PaidCaseOpenResult,
} from "../paid-case/types.js";
import { friendlyReferralCaseError } from "../referral-case/messages.js";
import type {
  ReferralCaseCatalog,
  ReferralCaseOpenResult,
} from "../referral-case/types.js";
import { parseReferralMe } from "../referrals/parse.js";
import { EMPTY_REFERRAL_ME } from "../referrals/types.js";
import { parseShopCatalog } from "../shop/parse.js";
import {
  clientShopValidationError,
  friendlyShopError,
  type ShopCatalogProduct,
} from "../shop/shop-messages.js";
import { ShopView, type ShopFilter } from "../shop/ShopView.js";
import type { ShopSuccessOrder } from "../shop/ShopOrderSuccessPopup.js";
import {
  applyServerBalance,
  refreshBalanceIfAmbiguous,
  useAzcBalance,
} from "../hooks/useAzcBalance.js";
import { CASE_ROULETTE_OPEN_SEQUENCE_MS } from "../cases/roulette-strip.js";
const REFERRAL_OPEN_ROUTE = "POST /cases/referral/open";

function shopTabFromHash(): "store" | "cases" {
  const path = window.location.hash.replace(/^#/, "");
  return path.startsWith("/shop/cases") ? "cases" : "store";
}

export function ShopPage({
  token,
  skipRemote = false,
}: {
  token: string;
  skipRemote?: boolean;
}) {
  const [catalog, setCatalog] = useState<ShopCatalogProduct[]>([]);
  const [paidCases, setPaidCases] = useState<PaidCaseCatalog[]>([]);
  const balanceAzc = useAzcBalance(token, skipRemote);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    skipRemote ? "ready" : "loading",
  );
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [mainTab, setMainTab] = useState<"store" | "cases">(shopTabFromHash);
  const [filter, setFilter] = useState<ShopFilter>("all");
  const [selected, setSelected] = useState<ShopCatalogProduct | undefined>();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [gifFile, setGifFile] = useState<File | null>(null);
  const [gifPreviewUrl, setGifPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState<string | undefined>();
  const [success, setSuccess] = useState(false);
  const [successOrder, setSuccessOrder] = useState<ShopSuccessOrder | undefined>();
  const [nonce, setNonce] = useState(0);

  const [selectedPaidCase, setSelectedPaidCase] =
    useState<PaidCaseCatalog | null>(null);
  const [caseOpening, setCaseOpening] = useState(false);
  const [caseAnimating, setCaseAnimating] = useState(false);
  const [caseResult, setCaseResult] = useState<PaidCaseOpenResult | null>(null);
  const [showCaseResult, setShowCaseResult] = useState(false);
  const [caseErrorNote, setCaseErrorNote] = useState<string | undefined>();
  const [referralProgress, setReferralProgress] = useState(
    EMPTY_REFERRAL_ME.caseProgress,
  );
  const [referralCatalog, setReferralCatalog] =
    useState<ReferralCaseCatalog | null>(null);
  const [referralSheetOpen, setReferralSheetOpen] = useState(false);
  const [referralOpening, setReferralOpening] = useState(false);
  const [referralAnimating, setReferralAnimating] = useState(false);
  const [referralResult, setReferralResult] =
    useState<ReferralCaseOpenResult | null>(null);
  const [showReferralResult, setShowReferralResult] = useState(false);
  const [referralErrorNote, setReferralErrorNote] = useState<string | undefined>();

  useEffect(() => {
    if (!gifFile) {
      setGifPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(gifFile);
    setGifPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [gifFile]);

  useEffect(() => {
    function syncTab(): void {
      setMainTab(shopTabFromHash());
    }
    window.addEventListener("hashchange", syncTab);
    return () => window.removeEventListener("hashchange", syncTab);
  }, []);

  useEffect(() => {
    if (skipRemote) {
      setStatus("ready");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    void Promise.allSettled([
      loadJson(token, "/shop/catalog", parseShopCatalog).then((listed) => {
        if (!cancelled) {
          setCatalog(listed.items);
        }
      }),
      loadJson(token, "/cases/paid", parsePaidCaseCatalog).then((cases) => {
        if (!cancelled) {
          setPaidCases(cases);
        }
      }),
      loadJson(token, "/referrals/me", parseReferralMe)
        .catch(() => EMPTY_REFERRAL_ME)
        .then((referral) => {
          if (!cancelled) {
            setReferralProgress(referral.caseProgress);
          }
        }),
      loadReferralCaseCatalog(token)
        .catch(() => null)
        .then((referralCase) => {
          if (!cancelled) {
            setReferralCatalog(referralCase);
          }
        }),
    ]).then((results) => {
      if (cancelled) {
        return;
      }
      const catalogFailed = results[0]?.status === "rejected";
      if (catalogFailed) {
        setStatus("error");
        setErrorMessage("Не удалось загрузить магазин");
        return;
      }
      setStatus("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [token, skipRemote, nonce]);

  useEffect(() => {
    if (!caseAnimating || !caseResult) {
      return;
    }
    const timer = window.setTimeout(() => {
      setCaseAnimating(false);
      setShowCaseResult(true);
    }, CASE_ROULETTE_OPEN_SEQUENCE_MS);
    return () => window.clearTimeout(timer);
  }, [caseAnimating, caseResult]);

  useEffect(() => {
    if (!referralAnimating || !referralResult) {
      return;
    }
    const timer = window.setTimeout(() => {
      setReferralAnimating(false);
      setShowReferralResult(true);
      applyServerBalance(referralResult.balances.azc);
      setReferralProgress((current) => ({
        ...current,
        availableCases: referralResult.availableCases,
      }));
      setReferralCatalog((current) =>
        current
          ? { ...current, availableCases: referralResult.availableCases }
          : current,
      );
    }, CASE_ROULETTE_OPEN_SEQUENCE_MS);
    return () => window.clearTimeout(timer);
  }, [referralAnimating, referralResult]);

  async function buy(): Promise<void> {
    if (!selected || submitting) {
      return;
    }
    const validation = clientShopValidationError(selected, fields);
    if (validation) {
      setNote(validation);
      setSuccess(false);
      setSuccessOrder(undefined);
      return;
    }
    if (skipRemote) {
      return;
    }
    const route = `POST /shop/orders:${selected.code}`;
    setSubmitting(true);
    setNote(undefined);
    try {
      const submittedData: Record<string, string> = {};
      for (const field of selected.requiredFields) {
        submittedData[field] = (fields[field] ?? "").trim();
      }
      if (selected.code === "gif-stream") {
        if (!gifFile) {
          setNote("Загрузите GIF");
          setSubmitting(false);
          return;
        }
        const uploaded = await uploadShopGif(token, gifFile);
        submittedData.gifUploadId = uploaded.uploadId;
      }
      const result = await createShopOrder(
        token,
        selected.code,
        submittedData,
        keyForPost(route),
      );
      clearIdempotencyKey(route);
      applyServerBalance(result.newBalanceAzc);
      setSuccessOrder({
        orderId: result.orderId,
        productTitle: selected.title,
        productCode: selected.code,
        priceAzc: result.priceAzc,
        fulfillmentType: selected.fulfillmentType,
      });
      setSuccess(true);
      setNote(undefined);
      setSelected(undefined);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status < 500) {
        clearIdempotencyKey(route);
      }
      setSuccess(false);
      setSuccessOrder(undefined);
      setNote(
        friendlyShopError(
          error instanceof ApiRequestError ? error.code : undefined,
        ),
      );
      await refreshBalanceIfAmbiguous(token, error);
    } finally {
      setSubmitting(false);
    }
  }

  async function openCase(): Promise<void> {
    if (!selectedPaidCase || caseOpening || caseAnimating || skipRemote) {
      return;
    }
    const route = `POST /cases/${selectedPaidCase.code}/open`;
    setCaseOpening(true);
    setCaseErrorNote(undefined);
    try {
      const opened = await openPaidCase(
        token,
        selectedPaidCase.code,
        keyForPost(route),
      );
      clearIdempotencyKey(route);
      setCaseResult(opened);
      setCaseAnimating(true);
      applyServerBalance(opened.balances.azc);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status < 500) {
        clearIdempotencyKey(route);
      }
      setCaseErrorNote(
        friendlyPaidCaseError(
          error instanceof ApiRequestError ? error.code : undefined,
        ),
      );
      await refreshBalanceIfAmbiguous(token, error);
    } finally {
      setCaseOpening(false);
    }
  }

  async function openReferralSheet(): Promise<void> {
    if (referralOpening || referralAnimating) {
      return;
    }
    setSelectedPaidCase(null);
    setCaseResult(null);
    setShowCaseResult(false);
    setCaseErrorNote(undefined);
    setReferralResult(null);
    setShowReferralResult(false);
    setReferralErrorNote(undefined);
    if (referralCatalog) {
      setReferralSheetOpen(true);
      return;
    }
    if (skipRemote) {
      setReferralCatalog((current) =>
        current ?? {
          code: "referral",
          title: "Реферальный",
          priceAzc: null,
          requiresEntitlement: true,
          availableCases: referralProgress.availableCases,
          items: [],
        },
      );
      setReferralSheetOpen(true);
      return;
    }
    try {
      const loaded = await loadReferralCaseCatalog(token);
      setReferralCatalog(loaded);
      setReferralSheetOpen(true);
    } catch {
      setReferralErrorNote("Не удалось загрузить кейс");
      setReferralCatalog((current) =>
        current ?? {
          code: "referral",
          title: "Реферальный",
          priceAzc: null,
          requiresEntitlement: true,
          availableCases: referralProgress.availableCases,
          items: [],
        },
      );
      setReferralSheetOpen(true);
    }
  }

  async function openReferral(): Promise<void> {
    if (referralOpening || referralAnimating || skipRemote) {
      return;
    }
    const available =
      referralCatalog?.availableCases ?? referralProgress.availableCases;
    if (available <= 0) {
      return;
    }
    setReferralOpening(true);
    setReferralErrorNote(undefined);
    try {
      const opened = await openReferralCase(token, keyForPost(REFERRAL_OPEN_ROUTE));
      clearIdempotencyKey(REFERRAL_OPEN_ROUTE);
      setReferralResult(opened);
      setReferralAnimating(true);
      applyServerBalance(opened.balances.azc);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status < 500) {
        clearIdempotencyKey(REFERRAL_OPEN_ROUTE);
      }
      setReferralErrorNote(
        friendlyReferralCaseError(
          error instanceof ApiRequestError ? error.code : undefined,
        ),
      );
      await refreshBalanceIfAmbiguous(token, error);
    } finally {
      setReferralOpening(false);
    }
  }

  return (
    <QueryPanel
      status={status === "loading" ? "loading" : status === "error" ? "error" : "ready"}
      {...(status === "error" && errorMessage ? { errorMessage } : {})}
      onRetry={() => setNonce((value) => value + 1)}
      loadingLabel="Загрузка магазина"
    >
      {status === "ready" ? (
          <ShopView
            catalog={catalog}
            paidCases={paidCases}
            balanceAzc={balanceAzc}
            mainTab={mainTab}
            filter={filter}
            {...(selected ? { selected } : {})}
            fields={fields}
            gifPreviewUrl={gifPreviewUrl}
            onGifFile={(file) => {
              setGifFile(file);
              setFields((current) => ({
                ...current,
                gifUploadId: file ? "pending" : "",
              }));
            }}
            submitting={submitting}
            {...(note ? { note } : {})}
            success={success}
            {...(successOrder ? { successOrder } : {})}
            selectedPaidCase={selectedPaidCase}
            caseOpening={caseOpening}
            caseAnimating={caseAnimating}
            caseResult={caseResult}
            {...(caseErrorNote ? { caseErrorNote } : {})}
            showCaseResult={showCaseResult}
            referralProgress={referralProgress}
            onMainTabChange={(tab) => {
              setMainTab(tab);
              navigate(tab === "cases" ? "#/shop/cases" : "#/shop");
            }}
            onFilterChange={setFilter}
            onSelect={(product) => {
              setSelected(product);
              setFields({});
              setGifFile(null);
              setNote(undefined);
              setSuccess(false);
              setSuccessOrder(undefined);
            }}
            onClose={() => {
              setSelected(undefined);
              setGifFile(null);
              setNote(undefined);
            }}
            onFieldChange={(field, value) => {
              setFields((current) => ({ ...current, [field]: value }));
            }}
            onBuy={() => {
              void buy();
            }}
            onDismissSuccess={() => {
              setSuccess(false);
              setSuccessOrder(undefined);
            }}
            onOrders={() => navigate("#/shop/orders")}
            onSelectPaidCase={(paidCase) => {
              setReferralSheetOpen(false);
              setReferralErrorNote(undefined);
              setSelectedPaidCase(paidCase);
              setCaseResult(null);
              setShowCaseResult(false);
              setCaseErrorNote(undefined);
              setCaseAnimating(false);
            }}
            onClosePaidCase={() => {
              if (caseOpening || caseAnimating) {
                return;
              }
              setSelectedPaidCase(null);
              setCaseErrorNote(undefined);
            }}
            onOpenPaidCase={() => {
              void openCase();
            }}
            onClosePaidCaseResult={() => {
              setShowCaseResult(false);
              setCaseResult(null);
              setSelectedPaidCase(null);
            }}
            referralCatalog={referralSheetOpen ? referralCatalog : null}
            referralOpening={referralOpening}
            referralAnimating={referralAnimating}
            referralResult={referralResult}
            {...(referralErrorNote ? { referralErrorNote } : {})}
            showReferralResult={showReferralResult}
            onSelectReferralCase={() => {
              void openReferralSheet();
            }}
            onCloseReferralCase={() => {
              if (referralOpening || referralAnimating) {
                return;
              }
              setReferralSheetOpen(false);
              setReferralErrorNote(undefined);
            }}
            onOpenReferralCase={() => {
              void openReferral();
            }}
            onCloseReferralCaseResult={() => {
              setShowReferralResult(false);
              setReferralResult(null);
              setReferralSheetOpen(false);
            }}
          />
      ) : null}
    </QueryPanel>
  );
}

export default ShopPage;
