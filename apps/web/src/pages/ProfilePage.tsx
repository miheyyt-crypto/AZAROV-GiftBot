import { useEffect, useState } from "react";
import { ApiRequestError, createGramWithdrawal, redeemPromo, startKickOAuth } from "../api.js";
import { QueryPanel } from "../components/QueryPanel.js";
import { clearIdempotencyKey, keyForPost } from "../idempotency.js";
import { groupDigits } from "../lib/format.js";
import { openTelegramLink } from "../telegram.js";
import { friendlyGramError } from "../profile/gram-messages.js";
import { ProfileView } from "../profile/ProfileView.js";
import { friendlyPromoError } from "../profile/promo-messages.js";
import {
  invalidateSharedProfile,
  loadSharedProfile,
  readCachedProfile,
} from "../profile/profile-store.js";
import { EMPTY_PROFILE_SUMMARY, type ProfileSummary } from "../profile/types.js";
import { useAuthedGet } from "../profile/useAuthedGet.js";
import {
  applyServerBalance,
  refreshBalanceIfAmbiguous,
  useAzcBalance,
} from "../hooks/useAzcBalance.js";
import { SUPPORT_URL } from "../lib/support.js";
import { parseStreamStreak } from "../stream-streak/parse.js";
import { EMPTY_STREAM_STREAK } from "../stream-streak/types.js";
const PROMO_ROUTE = "POST /promo/redeem";
const GRAM_ROUTE = "POST /gram/withdrawals";

export function ProfilePage({
  token,
  skipRemote = false,
  isSuperAdmin = false,
}: {
  token: string;
  skipRemote?: boolean;
  isSuperAdmin?: boolean;
}) {
  const cached = readCachedProfile(token);
  const [profileState, setProfileState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: ProfileSummary }
  >(
    skipRemote || cached
      ? { status: "ready", data: cached ?? EMPTY_PROFILE_SUMMARY }
      : { status: "loading" },
  );
  const streakQuery = useAuthedGet(
    token,
    "/stream-streak",
    parseStreamStreak,
    !skipRemote,
    EMPTY_STREAM_STREAK,
    false,
  );
  const [promo, setPromo] = useState("");
  const [promoNote, setPromoNote] = useState<string | undefined>();
  const [promoSubmitting, setPromoSubmitting] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawUsername, setWithdrawUsername] = useState("");
  const [withdrawNote, setWithdrawNote] = useState<string | undefined>();
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false);
  const [kickBusy, setKickBusy] = useState(false);
  const [kickNote, setKickNote] = useState<string | undefined>();
  const balanceAzc = useAzcBalance(token, skipRemote);

  useEffect(() => {
    if (skipRemote) {
      return;
    }
    const hit = readCachedProfile(token);
    if (hit) {
      setProfileState({ status: "ready", data: hit });
      return;
    }
    let cancelled = false;
    void loadSharedProfile(token)
      .then((data) => {
        if (!cancelled) {
          setProfileState({ status: "ready", data });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setProfileState({
            status: "error",
            message: error instanceof Error ? error.message : "request failed",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, skipRemote]);

  function retryProfile(): void {
    invalidateSharedProfile(token);
    setProfileState({ status: "loading" });
    void loadSharedProfile(token, { force: true })
      .then((data) => setProfileState({ status: "ready", data }))
      .catch((error: unknown) => {
        setProfileState({
          status: "error",
          message: error instanceof Error ? error.message : "request failed",
        });
      });
  }

  async function submitPromo(): Promise<void> {
    const code = promo.trim();
    if (!code || promoSubmitting) {
      return;
    }
    if (skipRemote) {
      return;
    }
    setPromoSubmitting(true);
    setPromoNote(undefined);
    try {
      const result = await redeemPromo(token, code, keyForPost(PROMO_ROUTE));
      clearIdempotencyKey(PROMO_ROUTE);
      applyServerBalance(result.newBalanceAzc);
      setPromo("");
      setPromoNote(`Промокод активирован\n+${groupDigits(result.rewardAzc)}`);
      retryProfile();
    } catch (error) {
      if (error instanceof ApiRequestError && error.status < 500) {
        clearIdempotencyKey(PROMO_ROUTE);
      }
      setPromoNote(
        friendlyPromoError(
          error instanceof ApiRequestError ? error.code : undefined,
        ),
      );
      await refreshBalanceIfAmbiguous(token, error);
    } finally {
      setPromoSubmitting(false);
    }
  }

  async function connectKick(): Promise<void> {
    if (skipRemote || kickBusy) {
      return;
    }
    setKickBusy(true);
    setKickNote(undefined);
    try {
      const started = await startKickOAuth(token);
      window.location.assign(started.authorizationUrl);
    } catch {
      setKickNote("Не удалось начать привязку Kick");
      setKickBusy(false);
    }
  }
  async function submitWithdraw(): Promise<void> {
    const username = withdrawUsername.trim();
    if (!username || withdrawSubmitting) {
      return;
    }
    if (skipRemote) {
      return;
    }
    setWithdrawSubmitting(true);
    setWithdrawNote(undefined);
    try {
      const result = await createGramWithdrawal(
        token,
        username,
        keyForPost(GRAM_ROUTE),
      );
      clearIdempotencyKey(GRAM_ROUTE);
      setWithdrawOpen(false);
      setWithdrawUsername("");
      setWithdrawNote(`Заявка создана на ${result.amountGram} Gram`);
      retryProfile();
    } catch (error) {
      if (error instanceof ApiRequestError && error.status < 500) {
        clearIdempotencyKey(GRAM_ROUTE);
      }
      setWithdrawNote(
        friendlyGramError(
          error instanceof ApiRequestError ? error.code : undefined,
        ),
      );
    } finally {
      setWithdrawSubmitting(false);
    }
  }

  const profileAzc =
    profileState.status === "ready" ? profileState.data.balances.azc : null;
  useEffect(() => {
    if (profileAzc) {
      applyServerBalance(profileAzc);
    }
  }, [profileAzc]);

  return (
    <QueryPanel
      status={profileState.status}
      {...(profileState.status === "error"
        ? { errorMessage: profileState.message }
        : {})}
      onRetry={retryProfile}
      loadingLabel="Загрузка профиля"
    >
      {profileState.status === "ready" ? (
        <ProfileView
          summary={profileState.data}
          balanceAzc={balanceAzc}
          streamStreak={
            streakQuery.status === "ready"
              ? streakQuery.data.currentStreak
              : EMPTY_STREAM_STREAK.currentStreak
          }
          promo={promo}
          {...(promoNote ? { promoNote } : {})}
          promoSubmitting={promoSubmitting}
          showAdminPromo={isSuperAdmin}
          withdrawOpen={withdrawOpen}
          withdrawUsername={withdrawUsername}
          {...(withdrawNote ? { withdrawNote } : {})}
          withdrawSubmitting={withdrawSubmitting}
          kickBusy={kickBusy}
          {...(kickNote ? { kickNote } : {})}
          onPromoChange={setPromo}
          onPromoSubmit={() => {
            void submitPromo();
          }}
          onSupport={() => openTelegramLink(SUPPORT_URL)}
          onKickConnect={() => {
            void connectKick();
          }}
          onWithdrawOpen={() => {
            setWithdrawNote(undefined);
            setWithdrawOpen(true);
          }}
          onWithdrawClose={() => setWithdrawOpen(false)}
          onWithdrawUsernameChange={setWithdrawUsername}
          onWithdrawSubmit={() => {
            void submitWithdraw();
          }}
        />
      ) : null}
    </QueryPanel>
  );
}

export default ProfilePage;
