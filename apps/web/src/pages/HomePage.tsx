import { useEffect, useState } from "react";
import { ApiRequestError, loadGiveaways, loadJson, openFreeCase } from "../api.js";
import { openTelegramLink } from "../telegram.js";
import { navigate } from "../app/routes.js";
import { IconGift } from "../assets/icons.js";
import { Avatar } from "../components/Avatar.js";
import { CoinAmount } from "../components/CoinAmount.js";
import { EmptyState } from "../components/EmptyState.js";
import { GameBanners } from "../components/GameBanners.js";
import { IdentityHeader } from "../components/IdentityHeader.js";
import { SegmentedTabs } from "../components/SegmentedTabs.js";
import { FreeCasePanel } from "../free-case/FreeCasePanel.js";
import {
  formatRecentWinChance,
  formatRecentWinReward,
  formatRelativeTime,
  friendlyFreeCaseError,
  lastOpeningFromFreeCaseOpen,
  recentWinFromFreeCaseOpen,
  recentWinSourceLabel,
} from "../free-case/messages.js";
import { parseFreeCaseStatus, parseRecentWins } from "../free-case/parse.js";
import type { FreeCaseOpenResult, FreeCaseStatus, RecentWin } from "../free-case/types.js";
import { GiveawaysView } from "../giveaways/GiveawaysView.js";
import type { GiveawayPublic, GiveawayTab } from "../giveaways/types.js";
import { clearIdempotencyKey, keyForPost } from "../idempotency.js";
import { homePodiumSlots } from "../leaderboard/home-podium.js";
import {
  leaderboardDisplayName,
  parseBalanceLeaderboard,
} from "../leaderboard/parse.js";
import type { BalanceLeaderboardEntry } from "../leaderboard/types.js";
import { StreamStreakCard } from "../stream-streak/StreamStreakCard.js";
import { parseStreamStreak } from "../stream-streak/parse.js";
import {
  EMPTY_STREAM_STREAK,
  type StreamStreakState,
} from "../stream-streak/types.js";
import { profileSummaryFromBootstrap } from "../profile/from-bootstrap.js";
import { EMPTY_PROFILE_SUMMARY, type ProfileSummary } from "../profile/types.js";
import type { BootstrapPayload } from "../types.js";
import {
  applyServerBalance,
  refreshBalanceIfAmbiguous,
  useAzcBalance,
} from "../hooks/useAzcBalance.js";
import { CASE_ROULETTE_OPEN_SEQUENCE_MS } from "../cases/roulette-strip.js";
import { ContestHomeBanner } from "../contest/ContestHomeBanner.js";
import { parseContestHomeSummaryResponse } from "../contest/parse.js";
import type { ReferralContestHomeSummary } from "../contest/types.js";

const OPEN_ROUTE = "POST /cases/free/open";

const EMPTY_STATUS: FreeCaseStatus = {
  caseCode: "free",
  available: true,
  nextAvailableAt: null,
  remainingSeconds: 0,
  displayTotals: { legendary: "6", epic: "20", common: "74" },
  catalog: [],
  lastOpening: null,
};

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="section-heading">
      <span className="section-heading__bar" aria-hidden="true" />
      <span>{children}</span>
    </h2>
  );
}

function HomePodium({
  top3,
  status,
  onOpen,
}: {
  top3: BalanceLeaderboardEntry[];
  status: "loading" | "ready" | "error";
  onOpen: () => void;
}) {
  const { first, second, third } = homePodiumSlots(top3);

  return (
    <button type="button" className="card card--btn podium-card" onClick={onOpen}>
      <SectionHeading>Топ лудиков</SectionHeading>
      {status === "loading" ? (
        <p className="muted">Загрузка…</p>
      ) : status === "error" ? (
        <div className="podium-card__error">
          <p className="muted">Не удалось загрузить топ</p>
          <span className="podium-card__retry">Нажмите, чтобы открыть рейтинг</span>
        </div>
      ) : (
        <div className="home-podium" aria-label="Топ-3 по балансу">
          <PodiumSlot entry={second} place={2} />
          <PodiumSlot entry={first} place={1} />
          <PodiumSlot entry={third} place={3} />
        </div>
      )}
    </button>
  );
}

function PodiumSlot({
  entry,
  place,
}: {
  entry: BalanceLeaderboardEntry | undefined;
  place: 1 | 2 | 3;
}) {
  if (!entry) {
    return (
      <div className={`home-podium__slot home-podium__slot--${place} is-empty`}>
        <div className={`home-podium__avatar-wrap home-podium__avatar-wrap--${place}`}>
          <span className="avatar avatar--empty" aria-hidden="true">
            —
          </span>
          <span className="home-podium__badge">{place}</span>
        </div>
        <p className="home-podium__name">—</p>
        <p className="home-podium__azc home-podium__azc--empty">—</p>
        <div className={`home-podium__block home-podium__block--${place}`} aria-hidden="true">
          {place}
        </div>
      </div>
    );
  }
  const name = leaderboardDisplayName(entry);
  return (
    <div className={`home-podium__slot home-podium__slot--${place}`}>
      <div className={`home-podium__avatar-wrap home-podium__avatar-wrap--${place}`}>
        <Avatar name={name} src={entry.avatarUrl} />
        <span className="home-podium__badge">{place}</span>
      </div>
      <p className="home-podium__name">{name}</p>
      <p className="home-podium__azc">
        <CoinAmount amount={entry.balanceAzc} size={14} />
      </p>
      <div className={`home-podium__block home-podium__block--${place}`} aria-hidden="true">
        {place}
      </div>
    </div>
  );
}

export function HomePage({
  token,
  skipRemote = false,
  viewerPublicId,
  bootstrap,
}: {
  token: string;
  skipRemote?: boolean;
  viewerPublicId?: string;
  bootstrap?: BootstrapPayload;
}) {
  const [giveawayTab, setGiveawayTab] = useState<GiveawayTab>("active");
  const [giveaways, setGiveaways] = useState<GiveawayPublic[]>([]);
  const [giveawayServerTime, setGiveawayServerTime] = useState(() =>
    new Date().toISOString(),
  );
  const [giveawayFetchedAtMs, setGiveawayFetchedAtMs] = useState(() => Date.now());
  const [top3, setTop3] = useState<BalanceLeaderboardEntry[]>([]);
  const [topStatus, setTopStatus] = useState<"loading" | "ready" | "error">(
    skipRemote ? "ready" : "loading",
  );
  const [recentStatus, setRecentStatus] = useState<"loading" | "ready" | "error">(
    skipRemote ? "ready" : "loading",
  );

  const [status, setStatus] = useState<FreeCaseStatus>(EMPTY_STATUS);
  const [fetchedAtMs, setFetchedAtMs] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [statusReady, setStatusReady] = useState(skipRemote);
  const [opening, setOpening] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [result, setResult] = useState<FreeCaseOpenResult | null>(null);
  const [showContents, setShowContents] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [errorNote, setErrorNote] = useState<string | undefined>();
  const [recentWins, setRecentWins] = useState<RecentWin[]>([]);
  const [streak, setStreak] = useState<StreamStreakState>(EMPTY_STREAM_STREAK);
  const [contestSummary, setContestSummary] =
    useState<ReferralContestHomeSummary | null>(null);
  const [contestFetchedAtMs, setContestFetchedAtMs] = useState(() => Date.now());
  const [profile, setProfile] = useState<ProfileSummary>(() =>
    bootstrap ? profileSummaryFromBootstrap(bootstrap) : EMPTY_PROFILE_SUMMARY,
  );
  const balanceAzc = useAzcBalance(token, skipRemote, { remoteOnMount: false });

  useEffect(() => {
    if (bootstrap) {
      setProfile(profileSummaryFromBootstrap(bootstrap));
      applyServerBalance(bootstrap.wallet.balanceMinor);
    }
  }, [bootstrap]);

  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    let timer: number | undefined;
    const arm = () => {
      if (document.visibilityState === "hidden") {
        if (timer !== undefined) {
          window.clearInterval(timer);
          timer = undefined;
        }
        return;
      }
      if (timer === undefined) {
        timer = window.setInterval(tick, 1000);
      }
    };
    arm();
    const onVis = () => arm();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (timer !== undefined) {
        window.clearInterval(timer);
      }
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    if (skipRemote) {
      setStatusReady(true);
      setTopStatus("ready");
      setRecentStatus("ready");
      return;
    }
    let cancelled = false;
    void Promise.all([
      loadJson(token, "/cases/free", parseFreeCaseStatus)
        .then((free) => {
          if (!cancelled) {
            setStatus(free);
            setFetchedAtMs(Date.now());
          }
        })
        .catch(() => {
          if (!cancelled) {
            setErrorNote("Не удалось загрузить бесплатный кейс");
          }
        }),
      loadJson(token, "/recent-wins?limit=12", parseRecentWins)
        .then((wins) => {
          if (!cancelled) {
            setRecentWins(wins.items);
            setRecentStatus("ready");
          }
        })
        .catch(() => {
          if (!cancelled) {
            setRecentStatus("error");
          }
        }),
      loadJson(token, "/stream-streak", parseStreamStreak)
        .then((streamStreak) => {
          if (!cancelled) {
            setStreak(streamStreak);
          }
        })
        .catch(() => undefined),
      loadJson(token, "/leaderboard/balance", parseBalanceLeaderboard)
        .then((board) => {
          if (!cancelled) {
            setTop3(board.items.slice(0, 3));
            setTopStatus("ready");
          }
        })
        .catch(() => {
          if (!cancelled) {
            setTopStatus("error");
          }
        }),
      loadJson(token, "/contest/referral/summary", parseContestHomeSummaryResponse)
        .then((summary) => {
          if (!cancelled) {
            setContestSummary(summary);
            setContestFetchedAtMs(Date.now());
          }
        })
        .catch(() => undefined),
    ]).finally(() => {
      if (!cancelled) {
        setStatusReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token, skipRemote]);

  useEffect(() => {
    if (skipRemote) {
      setGiveaways([]);
      return;
    }
    let cancelled = false;
    void loadGiveaways(token, giveawayTab)
      .then((listed) => {
        if (cancelled) {
          return;
        }
        setGiveaways(listed.items);
        setGiveawayServerTime(listed.serverTime);
        setGiveawayFetchedAtMs(Date.now());
      })
      .catch(() => {
        if (!cancelled) {
          setGiveaways([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, skipRemote, giveawayTab]);

  useEffect(() => {
    if (!animating || !result) {
      return;
    }
    const timer = window.setTimeout(() => {
      setAnimating(false);
      setShowResultModal(true);
      setStatus((current) => ({
        ...current,
        available: false,
        nextAvailableAt: result.nextAvailableAt,
        remainingSeconds: Math.max(
          0,
          Math.ceil((Date.parse(result.nextAvailableAt) - Date.now()) / 1000),
        ),
        lastOpening: lastOpeningFromFreeCaseOpen(result),
      }));
      setFetchedAtMs(Date.now());
      setRecentWins((current) => [
        recentWinFromFreeCaseOpen(result),
        ...current.filter((row) => row.id !== result.openingId),
      ]);
    }, CASE_ROULETTE_OPEN_SEQUENCE_MS);
    return () => window.clearTimeout(timer);
  }, [animating, result]);

  async function handleOpen(): Promise<void> {
    if (opening || animating || skipRemote) {
      return;
    }
    setOpening(true);
    setErrorNote(undefined);
    setShowResultModal(false);
    setResult(null);
    try {
      const opened = await openFreeCase(token, keyForPost(OPEN_ROUTE));
      clearIdempotencyKey(OPEN_ROUTE);
      setResult(opened);
      setAnimating(true);
      setShowContents(false);
      applyServerBalance(opened.balances.azc);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status < 500) {
        clearIdempotencyKey(OPEN_ROUTE);
      }
      if (
        error instanceof ApiRequestError &&
        error.code === "FREE_CASE_COOLDOWN_ACTIVE" &&
        error.nextAvailableAt
      ) {
        setStatus((current) => ({
          ...current,
          available: false,
          nextAvailableAt: error.nextAvailableAt ?? current.nextAvailableAt,
          remainingSeconds: Math.max(
            0,
            Math.ceil(
              (Date.parse(error.nextAvailableAt ?? "") - Date.now()) / 1000,
            ),
          ),
        }));
        setFetchedAtMs(Date.now());
      }
      setErrorNote(
        friendlyFreeCaseError(
          error instanceof ApiRequestError ? error.code : undefined,
        ),
      );
      await refreshBalanceIfAmbiguous(token, error);
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="stack home-page">
      <IdentityHeader summary={profile} balanceAzc={balanceAzc} />
      {contestSummary?.contest ? (
        <ContestHomeBanner
          page={contestSummary}
          fetchedAtMs={contestFetchedAtMs}
          nowMs={nowMs}
          onInvite={() => {
            const url = contestSummary.me.referralUrl;
            if (!url) {
              return;
            }
            openTelegramLink(
              `https://t.me/share/url?url=${encodeURIComponent(url)}`,
            );
          }}
        />
      ) : null}
      {statusReady ? (
        <FreeCasePanel
          status={status}
          opening={opening}
          animating={animating}
          result={result}
          {...(errorNote ? { errorNote } : {})}
          showContents={showContents}
          showResultModal={showResultModal}
          nowMs={nowMs}
          fetchedAtMs={fetchedAtMs}
          onOpenContents={() => setShowContents(true)}
          onCloseContents={() => setShowContents(false)}
          onOpen={() => {
            void handleOpen();
          }}
          onCloseResult={() => setShowResultModal(false)}
          onTryPaidCases={() => navigate("#/shop/cases")}
        />
      ) : (
        <section className="card">
          <p className="muted">Загрузка бесплатного кейса…</p>
        </section>
      )}

      <StreamStreakCard streak={streak} />

      <button
        type="button"
        className="card card--btn stream-support-home"
        onClick={() => navigate("#/support")}
      >
        <p className="stream-support-home__kicker">AZAROV Alerts</p>
        <p className="stream-support-home__title">Поддержать стрим</p>
        <p className="muted">Донат 1000 монет появится на эфире.</p>
      </button>

      <GameBanners className="home-games" />

      <section className="card stack giveaways-home">
        <div className="mini-row">
          <h2>Розыгрыши</h2>
          <button
            type="button"
            className="text-link"
            onClick={() => navigate("#/giveaways")}
          >
            Все
          </button>
        </div>
        <SegmentedTabs
          tone="purple"
          value={giveawayTab}
          options={[
            { id: "active", label: "🎁 Активные" },
            { id: "completed", label: "🏆 Завершённые" },
          ]}
          onChange={setGiveawayTab}
        />
        {giveaways.length === 0 && giveawayTab === "active" ? (
          <div className="giveaway-empty">
            <div className="giveaway-empty__icon">
              <IconGift size={40} />
            </div>
            <p className="giveaway-empty__title">Нет активных розыгрышей</p>
            <p className="muted">
              Загляните в завершённые или следите за анонсами.
            </p>
            <button
              type="button"
              className="ghost giveaway-empty__history"
              onClick={() => {
                setGiveawayTab("completed");
                navigate("#/giveaways");
              }}
            >
              Посмотреть историю
            </button>
            <span className="sr-only">Пусто</span>
          </div>
        ) : (
          <GiveawaysView
            tab={giveawayTab}
            items={giveaways}
            serverTime={giveawayServerTime}
            fetchedAtMs={giveawayFetchedAtMs}
            nowMs={nowMs}
            {...(viewerPublicId ? { viewerPublicId } : {})}
            compact
            onCardClick={() => navigate("#/giveaways")}
          />
        )}
      </section>

      <HomePodium
        top3={top3}
        status={topStatus}
        onOpen={() => navigate("#/leaderboard")}
      />

      <section className="recent-wins">
        <SectionHeading>Только что выпало</SectionHeading>
        {recentStatus === "loading" ? (
          <p className="muted">Загрузка…</p>
        ) : recentStatus === "error" ? (
          <p className="muted">Не удалось загрузить ленту выигрышей</p>
        ) : recentWins.length === 0 ? (
          <EmptyState
            title="Пока нет недавних выигрышей"
            text="Здесь появятся свежие выигрыши."
          />
        ) : (
          <div className="drop-row" role="list">
            {recentWins.map((drop) => {
              const name =
                drop.displayName || drop.username || drop.publicId || "Игрок";
              const reward = formatRecentWinReward(drop);
              const chance = formatRecentWinChance(drop.realChance);
              const time = formatRelativeTime(drop.createdAt, nowMs);
              const footer = [chance, time].filter(Boolean).join("  ·  ");
              return (
                <article
                  key={drop.id}
                  className="drop-card"
                  data-testid="recent-win"
                  role="listitem"
                >
                  <div className="drop-card__head">
                    <Avatar name={name} src={drop.avatarUrl} />
                    <p className="drop-card__user">{name}</p>
                  </div>
                  <p className="drop-card__source">{recentWinSourceLabel(drop.source)}</p>
                  <p className="drop-card__reward">
                    {reward.kind === "azc" ? (
                      <>
                        <CoinAmount amount={reward.label.replace(/\s/g, "")} size={16} />
                      </>
                    ) : (
                      <span>{reward.label}</span>
                    )}
                  </p>
                  {footer ? <p className="drop-card__footer">{footer}</p> : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <p className="home-footer">@AZAROV_GiftBot</p>
    </div>
  );
}

export default HomePage;
