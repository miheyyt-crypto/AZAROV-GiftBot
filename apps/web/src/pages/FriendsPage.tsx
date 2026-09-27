import { useEffect, useState } from "react";
import {
  ApiRequestError,
  loadJson,
  loadReferralCaseCatalog,
  openReferralCase,
} from "../api.js";
import { QueryPanel } from "../components/QueryPanel.js";
import { clearIdempotencyKey, keyForPost } from "../idempotency.js";
import { friendlyReferralCaseError } from "../referral-case/messages.js";
import { ReferralCaseSheet } from "../referral-case/ReferralCaseSheet.js";
import type {
  ReferralCaseCatalog,
  ReferralCaseOpenResult,
} from "../referral-case/types.js";
import { FriendsView } from "../referrals/FriendsView.js";
import { parseReferralList, parseReferralMe } from "../referrals/parse.js";
import {
  EMPTY_REFERRAL_LIST,
  EMPTY_REFERRAL_ME,
  type ReferralListResponse,
  type ReferralMeSummary,
} from "../referrals/types.js";
import { openTelegramLink } from "../telegram.js";
import {
  applyServerBalance,
  refreshBalanceIfAmbiguous,
  useAzcBalance,
} from "../hooks/useAzcBalance.js";
import { CASE_ROULETTE_OPEN_SEQUENCE_MS } from "../cases/roulette-strip.js";
const OPEN_ROUTE = "POST /cases/referral/open";

export function FriendsPage({
  token,
  skipRemote = false,
}: {
  token: string;
  skipRemote?: boolean;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    skipRemote ? "ready" : "loading",
  );
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [nonce, setNonce] = useState(0);
  const [me, setMe] = useState<ReferralMeSummary>(EMPTY_REFERRAL_ME);
  const [list, setList] = useState<ReferralListResponse>(EMPTY_REFERRAL_LIST);
  const balanceAzc = useAzcBalance(token, skipRemote);
  const [copied, setCopied] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [catalog, setCatalog] = useState<ReferralCaseCatalog | null>(null);
  const [caseOpening, setCaseOpening] = useState(false);
  const [caseAnimating, setCaseAnimating] = useState(false);
  const [caseResult, setCaseResult] = useState<ReferralCaseOpenResult | null>(
    null,
  );
  const [showCaseResult, setShowCaseResult] = useState(false);
  const [caseErrorNote, setCaseErrorNote] = useState<string | undefined>();

  useEffect(() => {
    if (skipRemote) {
      setStatus("ready");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    void Promise.all([
      loadJson(token, "/referrals/me", parseReferralMe),
      loadJson(token, "/referrals", parseReferralList),
    ])
      .then(([summary, referrals]) => {
        if (cancelled) {
          return;
        }
        setMe(summary);
        setList(referrals);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage("Не удалось загрузить рефералы");
        }
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
      applyServerBalance(caseResult.balances.azc);
      setMe((prev) => ({
        ...prev,
        caseProgress: {
          ...prev.caseProgress,
          availableCases: caseResult.availableCases,
        },
      }));
    }, CASE_ROULETTE_OPEN_SEQUENCE_MS);
    return () => window.clearTimeout(timer);
  }, [caseAnimating, caseResult]);

  async function openSheet(): Promise<void> {
    if (skipRemote) {
      setSheetOpen(true);
      return;
    }
    setCaseErrorNote(undefined);
    try {
      const loaded = await loadReferralCaseCatalog(token);
      setCatalog(loaded);
      setSheetOpen(true);
    } catch {
      setCaseErrorNote("Не удалось загрузить кейс");
      setSheetOpen(true);
      setCatalog({
        code: "referral",
        title: "Реферальный",
        priceAzc: null,
        requiresEntitlement: true,
        availableCases: me.caseProgress.availableCases,
        items: [],
      });
    }
  }

  async function openCase(): Promise<void> {
    if (caseOpening || caseAnimating || skipRemote) {
      return;
    }
    if (me.caseProgress.availableCases <= 0) {
      return;
    }
    setCaseOpening(true);
    setCaseErrorNote(undefined);
    try {
      const opened = await openReferralCase(token, keyForPost(OPEN_ROUTE));
      clearIdempotencyKey(OPEN_ROUTE);
      setCaseResult(opened);
      setCaseAnimating(true);
      applyServerBalance(opened.balances.azc);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status < 500) {
        clearIdempotencyKey(OPEN_ROUTE);
      }
      setCaseErrorNote(
        friendlyReferralCaseError(
          error instanceof ApiRequestError ? error.code : undefined,
        ),
      );
      await refreshBalanceIfAmbiguous(token, error);
    } finally {
      setCaseOpening(false);
    }
  }

  return (
    <>
      <QueryPanel
        status={
          status === "loading"
            ? "loading"
            : status === "error"
              ? "error"
              : "ready"
        }
        {...(status === "error" && errorMessage ? { errorMessage } : {})}
        onRetry={() => setNonce((value) => value + 1)}
        loadingLabel="Загрузка рефералов"
      >
        {status === "ready" ? (
          <FriendsView
            me={me}
            list={list}
            balanceAzc={balanceAzc}
            copied={copied}
            onCopy={() => {
              if (!me.referralUrl) {
                return;
              }
              void navigator.clipboard
                .writeText(me.referralUrl)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
            onShare={() => {
              if (!me.referralUrl) {
                return;
              }
              openTelegramLink(
                `https://t.me/share/url?url=${encodeURIComponent(me.referralUrl)}`,
              );
            }}
            onOpenCase={() => {
              void openSheet();
            }}
          />
        ) : null}
      </QueryPanel>

      <ReferralCaseSheet
        catalog={sheetOpen ? catalog : null}
        availableCases={
          catalog?.availableCases ?? me.caseProgress.availableCases
        }
        opening={caseOpening}
        animating={caseAnimating}
        result={caseResult}
        {...(caseErrorNote ? { errorNote: caseErrorNote } : {})}
        showResultModal={showCaseResult}
        onClose={() => {
          setSheetOpen(false);
          setCatalog(null);
          setCaseErrorNote(undefined);
        }}
        onOpen={() => {
          void openCase();
        }}
        onCloseResult={() => {
          setShowCaseResult(false);
          setCaseResult(null);
          setSheetOpen(false);
          setCatalog(null);
          setNonce((value) => value + 1);
        }}
      />
    </>
  );
}

export default FriendsPage;
