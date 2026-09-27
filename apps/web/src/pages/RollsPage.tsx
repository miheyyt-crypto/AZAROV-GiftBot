import { useEffect, useRef, useState } from "react";
import {
  ApiRequestError,
  loadRollsCurrent,
  loadRollsProvablyFair,
  placeRollsBetApi,
} from "../api.js";
import {
  RollsClockIcon,
  RollsCoinIcon,
  RollsMarkIcon,
  RollsPointerIcon,
  RollsShieldIcon,
  RollsStarIcon,
  RollsUsersIcon,
} from "../games/rolls-icons.js";
import { Avatar } from "../components/Avatar.js";
import { httpsAvatarSrc } from "../lib/https-url.js";
import { BalanceBadge } from "../components/BalanceBadge.js";
import { CoinAmount } from "../components/CoinAmount.js";
import { PageHeader } from "../components/PageHeader.js";
import {
  refreshBalance,
  refreshBalanceIfAmbiguous,
  syncBalanceFromMutation,
  useAzcBalance,
} from "../hooks/useAzcBalance.js";
import { clearIdempotencyKey, keyForPost } from "../idempotency.js";
import { groupDigits } from "../lib/format.js";
import { getOrCreateClientSeed, setClientSeed } from "../games/client-seed.js";
import { ProvablyFairModal } from "../games/ProvablyFairModal.js";
import { parseRollsCurrent } from "../games/rolls-parse.js";
import {
  countdownSecondsLeft,
  forwardSpinTarget,
  interpolatedRotation,
  ROLLS_RESULT_DELAY_MS,
  ROLLS_SPIN_DURATION_MS,
  rollsHubAriaLabel,
  rollsHubView,
  shouldShowRollsResult,
  spinLinearProgress,
} from "../games/rolls-spin.js";
import {
  decideRollsSnapshotApply,
  loadNextRollsRound,
  mergeRollsYou,
  ROLLS_RESULT_HOLD_MS,
} from "../games/rolls-round-transition.js";
import {
  formatChancePercent,
  formatPlayerName,
  gameLabel,
  rollsWinnerCardName,
} from "../games/rolls-ui.js";
import { RollsWinnerModal } from "../games/RollsWinnerModal.js";
import type { RollsBoardWin, RollsCurrent, RollsRound } from "../games/rolls-types.js";
import { buildSectors, RollsWheelEngine } from "../games/rolls-wheel.js";

const QUICK_BETS = [100, 250, 500, 1000, 2500] as const;
const MIN_BET = 100;
const MAX_BET = 100_000;

function friendlyError(code?: string): string {
  switch (code) {
    case "INSUFFICIENT_BALANCE":
    case "INSUFFICIENT_FUNDS":
      return "Недостаточно монет";
    case "ROLLS_INVALID_BET":
      return "Ставка от 100";
    case "ROLLS_STAKE_LIMIT":
      return "Лимит ставки 100 000";
    case "ROLLS_ROUND_FULL":
      return "Раунд заполнен (1000)";
    case "ROLLS_BETTING_CLOSED":
      return "Ставки закрыты";
    case "ROLLS_INVALID_CLIENT_SEED":
      return "Неверный client seed";
    default:
      return "Не удалось сделать ставку";
  }
}

function wsUrl(token: string): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/games/rolls/ws?token=${encodeURIComponent(token)}`;
}

function applyClockOffset(serverTime: string): number {
  const serverMs = Date.parse(serverTime);
  if (!Number.isFinite(serverMs)) {
    return 0;
  }
  return serverMs - Date.now();
}

function clampBet(value: number): number {
  return Math.min(MAX_BET, Math.max(MIN_BET, Math.floor(value) || MIN_BET));
}

function RollsMoney({
  amount,
  sign = "none",
  size = 14,
}: {
  amount: string | number;
  sign?: "none" | "plus" | "minus" | "auto";
  size?: number;
}) {
  return (
    <CoinAmount
      amount={amount}
      sign={sign}
      size={size}
      icon={<RollsCoinIcon size={size} />}
    />
  );
}

function avatarSrc(key: string | null | undefined): string | undefined {
  return httpsAvatarSrc(key);
}

function RollsBoardCard({
  board,
  viewerUserId,
  winClass,
}: {
  board: RollsBoardWin;
  viewerUserId: string | null | undefined;
  winClass?: string;
}) {
  const label = rollsWinnerCardName(board.winnerId, board.winnerName, viewerUserId);
  return (
    <div className="rolls-side-card__body">
      <Avatar name={board.winnerName || board.winnerInitials} src={board.winnerAvatar} size={34} />
      <div className="rolls-side-card__meta">
        <p className="rolls-side-card__name">{label}</p>
        <p className="rolls-side-card__chance">
          ШАНС {formatChancePercent(board.chance)}%
        </p>
      </div>
      <p className={winClass ?? "rolls-side-card__win"}>
        <RollsMoney amount={board.amount} sign="plus" size={14} />
      </p>
    </div>
  );
}

export function RollsPage({
  token,
  skipRemote = false,
  preview = null,
}: {
  token: string;
  skipRemote?: boolean;
  preview?: RollsCurrent | null;
}) {
  const balanceAzc = useAzcBalance(token, skipRemote);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<RollsWheelEngine | null>(null);
  const versionRef = useRef<string | null>(null);
  const clockOffsetRef = useRef(0);
  const spinFromRef = useRef(0);
  const spinToRef = useRef(0);
  const spinKeyRef = useRef<string | null>(null);
  const resultShownForRef = useRef<string | null>(null);
  const resultTimerRef = useRef(0);
  const nextRoundTimerRef = useRef(0);
  const dismissedWinnerRef = useRef<string | null>(null);
  const snapRef = useRef<RollsCurrent | null>(preview);
  const resultHoldOpenRef = useRef(false);
  const pendingNextRef = useRef<RollsCurrent | null>(null);
  const [winnerModalOpen, setWinnerModalOpen] = useState(false);

  const [snap, setSnap] = useState<RollsCurrent | null>(preview);
  snapRef.current = snap;
  const [amount, setAmount] = useState(100);
  const [clientSeed, setSeed] = useState(() => getOrCreateClientSeed());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | undefined>();
  const [countdown, setCountdown] = useState<number | null>(null);
  const [pointerName, setPointerName] = useState("");
  const [showResult, setShowResult] = useState(false);
  const [pfOpen, setPfOpen] = useState(false);
  const [pfFields, setPfFields] = useState<Array<{ label: string; value: string }>>(
    [],
  );

  function resetRoundScopedUi(): void {
    spinKeyRef.current = null;
    resultShownForRef.current = null;
    dismissedWinnerRef.current = null;
    resultHoldOpenRef.current = false;
    pendingNextRef.current = null;
    window.clearTimeout(resultTimerRef.current);
    window.clearTimeout(nextRoundTimerRef.current);
    setShowResult(false);
    setWinnerModalOpen(false);
    setNote(undefined);
  }

  function scheduleNextRoundRefresh(endedRoundId: string): void {
    if (skipRemote) {
      return;
    }
    window.clearTimeout(nextRoundTimerRef.current);
    nextRoundTimerRef.current = window.setTimeout(() => {
      resultHoldOpenRef.current = false;
      const pending = pendingNextRef.current;
      pendingNextRef.current = null;
      if (pending && pending.round.roundId !== endedRoundId) {
        ingest(pending, false);
      }
      void loadNextRollsRound({
        endedRoundId,
        load: () => loadRollsCurrent(token),
      })
        .then((fresh) => {
          if (fresh && fresh.round.roundId !== endedRoundId) {
            ingest(fresh, false);
          }
        })
        .catch(() => undefined);
    }, ROLLS_RESULT_HOLD_MS);
  }

  function ingest(next: RollsCurrent, fromWs = false): void {
    const local = snapRef.current;
    const decision = decideRollsSnapshotApply({
      localRoundId: local?.round.roundId ?? null,
      localVersion: versionRef.current,
      incomingRoundId: next.round.roundId,
      incomingVersion: next.round.version,
      fromWs,
      holdLocalRound: resultHoldOpenRef.current,
    });
    if (decision === "ignore") {
      return;
    }
    if (decision === "defer") {
      pendingNextRef.current = next;
      return;
    }
    if (
      versionRef.current &&
      next.round.roundId === local?.round.roundId &&
      BigInt(next.round.version) > BigInt(versionRef.current) + 1n
    ) {
      void loadRollsCurrent(token)
        .then((fresh) => ingest(fresh, false))
        .catch(() => undefined);
    }
    const roundChanged = decision === "apply-reset";
    if (roundChanged) {
      resetRoundScopedUi();
    }
    versionRef.current = next.round.version;
    clockOffsetRef.current = applyClockOffset(next.serverTime);
    const merged: RollsCurrent = {
      round: next.round,
      serverTime: next.serverTime,
      you: mergeRollsYou(local?.you, next.you, roundChanged),
      previous: next.previous,
      top: next.top,
    };
    snapRef.current = merged;
    setSnap(merged);
  }

  useEffect(() => {
    if (skipRemote) {
      return;
    }
    let cancelled = false;
    void loadRollsCurrent(token)
      .then((current) => {
        if (!cancelled) {
          ingest(current);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token, skipRemote]);

  useEffect(() => {
    if (skipRemote) {
      return;
    }
    let socket: WebSocket | null = null;
    let closed = false;
    let reconnectTimer = 0;
    let attempt = 0;
    const connect = () => {
      socket = new WebSocket(wsUrl(token));
      socket.onopen = () => {
        attempt = 0;
      };
      socket.onmessage = (ev) => {
        try {
          const data: unknown = JSON.parse(String(ev.data));
          if (
            data &&
            typeof data === "object" &&
            (data as { type?: string }).type === "round_snapshot"
          ) {
            const parsed = parseRollsCurrent({
              round: (data as { round: unknown }).round,
              serverTime: (data as { serverTime: string }).serverTime,
              you:
                "you" in (data as object)
                  ? (data as { you?: unknown }).you
                  : null,
              previous:
                "previous" in (data as object)
                  ? (data as { previous: unknown }).previous
                  : snapRef.current?.previous ?? null,
              top:
                "top" in (data as object)
                  ? (data as { top: unknown }).top
                  : snapRef.current?.top ?? null,
            });
            ingest(parsed, true);
          }
        } catch {
          /* ignore */
        }
      };
      socket.onclose = () => {
        if (closed) {
          return;
        }
        const base = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
        const jitter = Math.floor(Math.random() * 500);
        attempt += 1;
        reconnectTimer = window.setTimeout(() => {
          void loadRollsCurrent(token)
            .then((current) => ingest(current))
            .catch(() => undefined);
          connect();
        }, base + jitter);
      };
    };
    connect();
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void loadRollsCurrent(token)
          .then((current) => ingest(current))
          .catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      closed = true;
      window.clearTimeout(reconnectTimer);
      document.removeEventListener("visibilitychange", onVis);
      socket?.close();
    };
  }, [token, skipRemote]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const engine = new RollsWheelEngine(canvas);
    engineRef.current = engine;
    engine.setOnPointerName(setPointerName);
    engine.setSectors(buildSectors([], 0), { idle: true, placeholder: true });
    engine.setHub({ kind: "waiting" });
    const root = document.getElementById("root");
    const width = root?.clientWidth || window.innerWidth;
    const size = Math.min(336, Math.max(260, width - 24));
    engine.resize(size);
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const round = snap?.round;
    const engine = engineRef.current;
    if (!round || !engine) {
      return;
    }
    const pot = Number(round.totalPotAzc);
    const idle = round.status === "waiting" || round.status === "betting";
    const placeholder = round.participants.length === 0;
    const sectors = buildSectors(round.participants, pot);
    engine.setSectors(sectors, { idle, placeholder });
  }, [snap?.round.roundId, snap?.round.version, snap?.round.status]);

  useEffect(() => {
    const round = snap?.round;
    const engine = engineRef.current;
    if (!round || !engine) {
      return;
    }
    if (round.status !== "spinning" && round.status !== "resolved") {
      spinKeyRef.current = null;
      resultHoldOpenRef.current = false;
      engine.stopLoop();
      window.clearTimeout(resultTimerRef.current);
      setShowResult(false);
      setWinnerModalOpen(false);
      if (round.status === "waiting") {
        resultShownForRef.current = null;
        dismissedWinnerRef.current = null;
      }
      return;
    }
    const winnerId = round.winnerParticipantId;
    if (!winnerId || !round.spinStartedAt) {
      return;
    }
    const key = `${round.roundId}:${round.spinStartedAt}`;
    if (spinKeyRef.current === key) {
      return;
    }
    spinKeyRef.current = key;
    resultHoldOpenRef.current = true;
    const pot = Number(round.totalPotAzc);
    const sectors = buildSectors(round.participants, pot);
    const winnerIndex = Math.max(
      0,
      sectors.findIndex((s) => s.participantId === winnerId),
    );
    spinFromRef.current = engine.getRotation();
    spinToRef.current = forwardSpinTarget({
      from: spinFromRef.current,
      winnerIndex,
      sectorAngles: sectors.map((s) => s.sweep),
    });
    const started = Date.parse(round.spinStartedAt);
    const startMs = Number.isFinite(started) ? started : Date.now();
    const duration =
      round.spinDurationMs > 0 ? round.spinDurationMs : ROLLS_SPIN_DURATION_MS;

    engine.startLoop(() => {
      const linear = spinLinearProgress(
        Date.now(),
        startMs,
        duration,
        clockOffsetRef.current,
      );
      engine.setRotation(
        interpolatedRotation(spinFromRef.current, spinToRef.current, linear),
      );
      if (!shouldShowRollsResult(linear)) {
        return true;
      }
      engine.setRotation(spinToRef.current);
      if (resultShownForRef.current !== round.roundId) {
        resultShownForRef.current = round.roundId;
        window.clearTimeout(resultTimerRef.current);
        resultTimerRef.current = window.setTimeout(() => {
          setShowResult(true);
          scheduleNextRoundRefresh(round.roundId);
        }, ROLLS_RESULT_DELAY_MS);
      }
      return false;
    });
  }, [
    snap?.round.roundId,
    snap?.round.status,
    snap?.round.spinStartedAt,
    snap?.round.winnerParticipantId,
  ]);

  useEffect(() => {
    const deadline = snap?.round.bettingDeadline ?? null;
    if (!deadline || snap?.round.status !== "betting") {
      setCountdown(
        countdownSecondsLeft(deadline, Date.now(), clockOffsetRef.current),
      );
      return;
    }
    const tickOnce = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      const left = countdownSecondsLeft(
        deadline,
        Date.now(),
        clockOffsetRef.current,
      );
      setCountdown(left);
      if (left === 0 && !skipRemote) {
        void loadRollsCurrent(token)
          .then((current) => ingest(current))
          .catch(() => undefined);
      }
    };
    tickOnce();
    const id = window.setInterval(tickOnce, 250);
    const onVis = () => {
      if (document.visibilityState === "visible") {
        tickOnce();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [snap?.round.bettingDeadline, snap?.round.status, skipRemote, token]);

  useEffect(() => {
    const round = snap?.round;
    const seconds =
      countdown ??
      (round?.status === "betting"
        ? countdownSecondsLeft(
            round.bettingDeadline,
            Date.now(),
            clockOffsetRef.current,
          )
        : null);
    engineRef.current?.setHub(rollsHubView(round, seconds));
  }, [snap?.round, countdown]);

  useEffect(() => {
    return () => {
      window.clearTimeout(resultTimerRef.current);
      window.clearTimeout(nextRoundTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const roundId = snap?.round.roundId;
    const winnerId = snap?.round.winnerParticipantId;
    const youId = snap?.you?.participantId;
    if (!showResult || !roundId || !winnerId || !youId || youId !== winnerId) {
      return;
    }
    if (dismissedWinnerRef.current === roundId) {
      return;
    }
    setWinnerModalOpen(true);
  }, [
    showResult,
    snap?.round.roundId,
    snap?.round.winnerParticipantId,
    snap?.you?.participantId,
  ]);

  useEffect(() => {
    if (skipRemote || !showResult) {
      return;
    }
    void refreshBalance(token, { force: true });
  }, [showResult, snap?.round.roundId, skipRemote, token]);

  async function onBet(): Promise<void> {
    if (busy || skipRemote) {
      return;
    }
    setBusy(true);
    setNote(undefined);
    const route = "POST /games/rolls/bet";
    try {
      const result = await placeRollsBetApi(
        token,
        { amountAzc: amount, clientSeed },
        keyForPost(route),
      );
      clearIdempotencyKey(route);
      ingest({
        round: result.round,
        serverTime: new Date().toISOString(),
        you: result.you,
        previous: snap?.previous ?? null,
        top: snap?.top ?? null,
      });
      await syncBalanceFromMutation(token, result);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status < 500) {
        clearIdempotencyKey(route);
      }
      setNote(
        friendlyError(error instanceof ApiRequestError ? error.code : undefined),
      );
      await refreshBalanceIfAmbiguous(token, error);
    } finally {
      setBusy(false);
    }
  }

  async function openPf(): Promise<void> {
    const round = snap?.round;
    if (!round || skipRemote) {
      return;
    }
    try {
      const pf = await loadRollsProvablyFair(token, round.roundId);
      setPfFields(
        Object.entries(pf).map(([label, value]) => ({
          label,
          value: value === null || value === undefined ? "—" : String(value),
        })),
      );
      setPfOpen(true);
    } catch {
      setNote("Не удалось загрузить Provably Fair");
    }
  }

  const round: RollsRound | undefined = snap?.round;
  const participating = Boolean(snap?.you?.participantId);
  const bettingOpen =
    round &&
    (round.status === "waiting" || round.status === "betting");
  const winner = round?.participants.find(
    (p) => p.participantId === round.winnerParticipantId,
  );
  const youWon =
    snap?.you?.participantId &&
    snap.you.participantId === round?.winnerParticipantId;

  const lastGame = snap?.previous ?? null;
  const topGame = snap?.top ?? null;
  const viewerUserId = snap?.you?.userId;
  const wallet = Number(balanceAzc) || 0;
  const minNote = wallet > 0 && wallet < MIN_BET ? "Нужно минимум 100 монет." : undefined;
  const closed =
    round?.status === "spinning" || round?.status === "resolved";
  const secondsLeft =
    countdown ??
    (round?.status === "betting"
      ? countdownSecondsLeft(
          round.bettingDeadline,
          Date.now(),
          clockOffsetRef.current,
        )
      : null);
  const hub = rollsHubView(round, secondsLeft);

  return (
    <div className="stack rolls-page">
      <div className="rolls-atmosphere" aria-hidden="true" />
      <PageHeader
        title="Roll"
        backHref="#/"
        align="start"
        icon={<RollsMarkIcon size={15} />}
        trailing={
          <BalanceBadge
            amountAzcString={balanceAzc}
            icon={<RollsCoinIcon size={14} />}
          />
        }
      />

      <div className="rolls-side-cards">
        <article className="rolls-side-card rolls-side-card--prev">
          <p className="rolls-side-card__label">
            <RollsClockIcon size={11} />
            ПРЕД. ИГРА
          </p>
          {lastGame ? (
            <RollsBoardCard board={lastGame} viewerUserId={viewerUserId} />
          ) : (
            <p className="muted rolls-side-card__empty">Пока нет</p>
          )}
        </article>
        <article className="rolls-side-card rolls-side-card--top">
          <p className="rolls-side-card__label">
            <RollsStarIcon size={11} />
            ТОП ИГРА
          </p>
          {topGame ? (
            <RollsBoardCard
              board={topGame}
              viewerUserId={viewerUserId}
              winClass="rolls-side-card__win rolls-side-card__win--gold"
            />
          ) : (
            <p className="muted rolls-side-card__empty">Пока пусто</p>
          )}
        </article>
      </div>

      <div className="rolls-pot-pill">
        <span>ВСЕГО</span>
        <RollsMoney amount={round?.totalPotAzc ?? "0"} size={14} />
      </div>

      <section className="rolls-stage">
        <div className={`rolls-pointer-name${pointerName ? "" : " is-empty"}`}>
          {pointerName ? formatPlayerName(pointerName) : "\u00a0"}
        </div>
        <div
          className="rolls-wheel"
          role="img"
          aria-label={rollsHubAriaLabel(hub)}
          data-rolls-hub={hub.kind}
          {...(hub.kind === "betting" ? { "data-rolls-countdown": String(hub.seconds) } : {})}
        >
          <span className="rolls-pointer" aria-hidden="true">
            <RollsPointerIcon />
          </span>
          <canvas ref={canvasRef} className="rolls-canvas" />
          <div className="sr-only rolls-avatar-preload" aria-hidden="true">
            {(round?.participants ?? []).map((p) => {
              const photo = avatarSrc(p.avatarUrl ?? p.avatarKey);
              if (!photo) {
                return null;
              }
              return (
                <img
                  key={p.participantId}
                  src={photo}
                  alt=""
                  width={64}
                  height={64}
                  decoding="async"
                  referrerPolicy="no-referrer"
                  ref={(el) => {
                    if (el?.complete && el.naturalWidth > 0) {
                      engineRef.current?.rememberAvatar(photo, el);
                    }
                  }}
                  onLoad={(event) => {
                    engineRef.current?.rememberAvatar(photo, event.currentTarget);
                  }}
                />
              );
            })}
          </div>
        </div>
      </section>

      {closed ? (
        <section className="rolls-closed">
          <p className="rolls-closed__title">
            {round?.status === "spinning" ? "Идёт спин" : "Раунд завершён"}
          </p>
          <p className="rolls-closed__sub">Ставки закрыты</p>
        </section>
      ) : (
        <section className="rolls-bet-panel">
          <p className="rolls-bet-panel__label">СУММА СТАВКИ</p>
          <div className="rolls-bet-row">
            <button
              type="button"
              className="rolls-chip"
              disabled={!bettingOpen || busy}
              onClick={() => setAmount((a) => clampBet(Math.floor(a / 2)))}
            >
              ½
            </button>
            <button
              type="button"
              className="rolls-chip"
              disabled={!bettingOpen || busy}
              onClick={() => setAmount((a) => clampBet(a * 2))}
            >
              2×
            </button>
            <label className="rolls-amount">
              <input
                type="number"
                min={MIN_BET}
                max={MAX_BET}
                step={1}
                value={amount}
                disabled={!bettingOpen || busy}
                onChange={(e) => setAmount(clampBet(Number(e.target.value) || MIN_BET))}
              />
              <RollsCoinIcon size={15} />
            </label>
            <button
              type="button"
              className="rolls-chip"
              disabled={!bettingOpen || busy}
              onClick={() => {
                const already = Number(snap?.you?.stakeAzc ?? 0);
                const remain = Math.max(MIN_BET, MAX_BET - already);
                setAmount(clampBet(Math.min(wallet, remain)));
              }}
            >
              МАКС
            </button>
          </div>
          <div className="rolls-quick">
            {QUICK_BETS.map((q) => {
              const unaffordable = wallet > 0 && wallet < q;
              return (
                <button
                  key={q}
                  type="button"
                  className={
                    amount === q
                      ? "rolls-chip is-active"
                      : unaffordable
                        ? "rolls-chip is-muted"
                        : "rolls-chip"
                  }
                  disabled={!bettingOpen || busy || unaffordable}
                  onClick={() => setAmount(q)}
                >
                  {groupDigits(String(q))}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="primary rolls-place-bet"
            disabled={!bettingOpen || busy}
            onClick={() => void onBet()}
          >
            {busy ? "…" : "Поставить"}
          </button>
          {minNote ? <p className="rolls-min-note">{minNote}</p> : null}
          {participating ? (
            <div className="rolls-you">
              <span>
                Твоя ставка:{" "}
                <strong>
                  <RollsMoney amount={snap?.you?.stakeAzc ?? "0"} size={13} />
                </strong>
              </span>
              <span>
                Шанс:{" "}
                <strong>{formatChancePercent(snap?.you?.chancePercent ?? "0")}%</strong>
              </span>
            </div>
          ) : null}
          <details className="rolls-advanced">
            <summary>
              <RollsShieldIcon size={13} />
              <span>Provably Fair</span>
            </summary>
            <label className="field">
              Client seed
              <input
                value={clientSeed}
                maxLength={128}
                disabled={participating || busy}
                onChange={(e) => {
                  const v = e.target.value.slice(0, 128);
                  setSeed(v);
                  setClientSeed(v);
                }}
              />
            </label>
            <button type="button" className="ghost" onClick={() => void openPf()}>
              Provably Fair
            </button>
          </details>
          {note ? <p className="error">{note}</p> : null}
        </section>
      )}

      {showResult && winner && round && !youWon ? (
        <section className="rolls-result" data-testid="rolls-result">
          <span className="rolls-result__warn" aria-hidden="true">
            !
          </span>
          <div className="rolls-result__copy">
            <p className="rolls-result__title">Раунд завершён</p>
            <p className="rolls-result__sub">
              Победитель: {formatPlayerName(winner.displayName)}
            </p>
            <p className="rolls-result__payout">
              <RollsMoney amount={round.payoutAzc ?? "0"} size={15} />
              <span>
                {formatChancePercent(
                  Number(round.totalPotAzc) > 0
                    ? String((Number(winner.stakeAzc) / Number(round.totalPotAzc)) * 100)
                    : "0",
                )}
                %
              </span>
            </p>
          </div>
        </section>
      ) : null}

      {showResult && youWon && winnerModalOpen && winner && round ? (
        <RollsWinnerModal
          round={round}
          winner={winner}
          onClose={() => {
            dismissedWinnerRef.current = round.roundId;
            setWinnerModalOpen(false);
          }}
        />
      ) : null}

      <section className="rolls-players">
        <div className="rolls-players__head">
          <h3>
            <RollsUsersIcon size={14} />
            <span>
              {round?.participantCount ?? 0} Игроков / 1000
            </span>
          </h3>
          <span>Игра #{gameLabel(round?.roundId)}</span>
        </div>
        {(round?.participantCount ?? 0) < 1 ? (
          <p className="muted rolls-players__empty">
            Сделайте ставку, чтобы начать игру
          </p>
        ) : (
          <ul className="rolls-participants">
            {(round?.participants ?? []).slice(0, 40).map((p) => {
              const pot = Number(round?.totalPotAzc ?? 0);
              const chance = pot > 0 ? (Number(p.stakeAzc) / pot) * 100 : 0;
              const photo = avatarSrc(p.avatarUrl ?? p.avatarKey);
              return (
                <li key={p.participantId}>
                  <Avatar
                    name={p.displayName}
                    size={36}
                    {...(photo ? { src: photo } : {})}
                  />
                  <span className="rolls-participants__copy">
                    <span className="rolls-participants__name">
                      {formatPlayerName(p.displayName)}
                    </span>
                    <span className="rolls-participants__chance">
                      {formatChancePercent(String(chance))}%
                    </span>
                  </span>
                  <span className="rolls-participants__stake">
                    <RollsMoney amount={p.stakeAzc} size={13} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {(round?.participantCount ?? 0) > 40 ? (
          <p className="muted">Показаны первые 40 из {round?.participantCount}</p>
        ) : null}
      </section>

      <ProvablyFairModal
        open={pfOpen}
        onClose={() => setPfOpen(false)}
        fields={pfFields}
      />
    </div>
  );
}

export default RollsPage;
