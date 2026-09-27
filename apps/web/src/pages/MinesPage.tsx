import { useEffect, useState } from "react";
import {
  ApiRequestError,
  cashoutMinesApi,
  loadActiveMines,
  revealMinesCellApi,
  startMines,
} from "../api.js";
import { IconCoin } from "../assets/icons.js";
import { BalanceBadge } from "../components/BalanceBadge.js";
import { CoinAmount } from "../components/CoinAmount.js";
import { PageHeader } from "../components/PageHeader.js";
import {
  refreshBalanceIfAmbiguous,
  syncBalanceFromMutation,
  useAzcBalance,
} from "../hooks/useAzcBalance.js";
import { clearIdempotencyKey, keyForPost } from "../idempotency.js";
import { groupDigits } from "../lib/format.js";
import { getOrCreateClientSeed, setClientSeed } from "../games/client-seed.js";
import { ProvablyFairModal } from "../games/ProvablyFairModal.js";
import { MinesBombIcon, MinesGemIcon } from "../games/mines-icons.js";
import {
  clampMinesBet,
  MINES_BOARD_CELLS,
  MINES_MAX_BET,
  MINES_MIN_BET,
  MINES_QUICK_BETS,
} from "../games/mines-ui.js";
import { MINE_COUNTS, type MinesGame } from "../games/types.js";

function friendlyError(code?: string): string {
  switch (code) {
    case "INSUFFICIENT_BALANCE":
      return "Недостаточно монет";
    case "MINES_GAME_ALREADY_ACTIVE":
      return "Уже есть активная игра";
    case "MINES_CASHOUT_TOO_EARLY":
      return "Сначала открой безопасную клетку";
    case "MINES_BET_OUT_OF_RANGE":
      return "Ставка от 100 до 10 000";
    default:
      return "Не удалось выполнить действие";
  }
}

export function MinesPage({
  token,
  skipRemote = false,
}: {
  token: string;
  skipRemote?: boolean;
}) {
  const [bet, setBet] = useState(100);
  const [mines, setMines] = useState<(typeof MINE_COUNTS)[number]>(5);
  const [clientSeed, setSeed] = useState(() => getOrCreateClientSeed());
  const [game, setGame] = useState<MinesGame | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | undefined>();
  const [pfOpen, setPfOpen] = useState(false);
  const balanceAzc = useAzcBalance(token, skipRemote);
  const wallet = Number(balanceAzc) || 0;

  useEffect(() => {
    if (skipRemote) {
      return;
    }
    let cancelled = false;
    void loadActiveMines(token)
      .then((res) => {
        if (!cancelled && res.game) {
          setGame(res.game);
          setBet(Number(res.game.betAzc));
          setMines(res.game.mineCount as (typeof MINE_COUNTS)[number]);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token, skipRemote]);

  async function onStart(): Promise<void> {
    if (busy || skipRemote) {
      return;
    }
    if (bet < MINES_MIN_BET) {
      setNote("Минимальная ставка — 100 монет");
      return;
    }
    if (bet > MINES_MAX_BET) {
      setNote(friendlyError("MINES_BET_OUT_OF_RANGE"));
      return;
    }
    if (wallet > 0 && bet > wallet) {
      setNote("Недостаточно монет");
      return;
    }
    setBusy(true);
    setNote(undefined);
    const route = "POST /games/mines/start";
    try {
      const result = await startMines(
        token,
        { betAzc: bet, mines, clientSeed },
        keyForPost(route),
      );
      clearIdempotencyKey(route);
      setGame(result.game);
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

  async function onReveal(cell: number): Promise<void> {
    if (!game || game.status !== "active" || busy || skipRemote) {
      return;
    }
    if (game.revealedCells.includes(cell)) {
      return;
    }
    setBusy(true);
    setNote(undefined);
    const route = `POST /games/mines/${game.gameId}/reveal`;
    try {
      const result = await revealMinesCellApi(
        token,
        game.gameId,
        cell,
        keyForPost(route),
      );
      clearIdempotencyKey(route);
      setGame(result.game);
      if (result.hitMine) {
        await syncBalanceFromMutation(token, result);
      }
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

  async function onCashout(): Promise<void> {
    if (!game || game.status !== "active" || busy || skipRemote) {
      return;
    }
    setBusy(true);
    setNote(undefined);
    const route = `POST /games/mines/${game.gameId}/cashout`;
    try {
      const result = await cashoutMinesApi(
        token,
        game.gameId,
        keyForPost(route),
      );
      clearIdempotencyKey(route);
      setGame(result.game);
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

  const active = game?.status === "active";
  const mineSet = new Set(game?.minePositions ?? []);
  const setupLocked = active || busy;
  const resolved = game && game.status !== "active";
  const won = game?.status === "cashed_out" || game?.status === "cleared";

  return (
    <div className="stack mines-page">
      <div className="mines-atmosphere" aria-hidden="true" />
      <PageHeader
        title="Mines"
        backHref="#/"
        align="start"
        icon={<MinesBombIcon size={18} />}
        trailing={<BalanceBadge amountAzcString={balanceAzc} />}
      />

      <section className="mines-board" aria-label="Поле Mines">
        <div className="mines-grid">
          {Array.from({ length: MINES_BOARD_CELLS }, (_, cell) => {
            const revealed = game?.revealedCells.includes(cell) ?? false;
            const isMine = Boolean(game && game.status !== "active" && mineSet.has(cell));
            const isSafeRevealed = revealed && !isMine;
            return (
              <button
                key={cell}
                type="button"
                className={`mines-cell${isMine ? " mines-cell--mine" : ""}${
                  isSafeRevealed ? " mines-cell--safe" : ""
                }`}
                disabled={!active || busy || revealed}
                onClick={() => void onReveal(cell)}
              >
                <span className="mines-cell__mark" aria-hidden="true">
                  {isMine ? <MinesBombIcon size={15} /> : isSafeRevealed ? <MinesGemIcon size={14} /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {active && game ? (
        <div className="mines-live">
          <span>×{game.currentMultiplier ?? "1.00"}</span>
          <CoinAmount amount={game.potentialPayoutAzc ?? game.betAzc} size={14} />
        </div>
      ) : null}

      {resolved && game ? (
        <section className={won ? "mines-result is-win" : "mines-result is-loss"}>
          <p className="mines-result__title">{won ? "Выигрыш" : "Проигрыш"}</p>
          <p className="mines-result__pay">
            <CoinAmount amount={game.payoutAzc ?? "0"} size={15} />
          </p>
        </section>
      ) : null}

      <section className="mines-panel">
        <p className="mines-panel__label">СУММА СТАВКИ</p>
        <div className="mines-bet-row">
          <button
            type="button"
            className="mines-chip"
            disabled={setupLocked}
            onClick={() => setBet((value) => clampMinesBet(Math.floor(value / 2)))}
          >
            ½
          </button>
          <button
            type="button"
            className="mines-chip"
            disabled={setupLocked}
            onClick={() => setBet((value) => clampMinesBet(value * 2))}
          >
            2×
          </button>
          <label className="mines-amount">
            <input
              type="number"
              min={MINES_MIN_BET}
              max={MINES_MAX_BET}
              step={1}
              value={bet}
              disabled={setupLocked}
              onChange={(e) => {
                const next = Math.floor(Number(e.target.value));
                setBet(Number.isFinite(next) ? next : 0);
              }}
            />
            <IconCoin size={15} />
          </label>
          <button
            type="button"
            className="mines-chip"
            disabled={setupLocked}
            onClick={() => {
              const cap = Math.max(MINES_MIN_BET, Math.min(MINES_MAX_BET, wallet || MINES_MAX_BET));
              setBet(clampMinesBet(cap));
            }}
          >
            МАКС
          </button>
        </div>
        <div className="mines-quick">
          {MINES_QUICK_BETS.map((amount) => {
            const unaffordable = wallet > 0 && wallet < amount;
            return (
              <button
                key={amount}
                type="button"
                className={
                  bet === amount
                    ? "mines-chip is-active"
                    : unaffordable
                      ? "mines-chip is-muted"
                      : "mines-chip"
                }
                disabled={setupLocked || unaffordable}
                onClick={() => setBet(amount)}
              >
                {groupDigits(String(amount))}
              </button>
            );
          })}
        </div>
      </section>

      <section className="mines-panel">
        <div className="mines-panel__head">
          <p className="mines-panel__label">КОЛИЧЕСТВО МИН</p>
          <span className="mines-count-badge">
            <MinesBombIcon size={14} />
            {mines}
          </span>
        </div>
        <div className="mines-counts">
          {MINE_COUNTS.map((count) => (
            <button
              key={count}
              type="button"
              className={mines === count ? "mines-chip is-mine" : "mines-chip"}
              disabled={setupLocked}
              onClick={() => setMines(count)}
            >
              {count}
            </button>
          ))}
        </div>
      </section>

      {!active ? (
        <button
          type="button"
          className="primary mines-cta"
          disabled={busy || skipRemote}
          onClick={() => void onStart()}
        >
          {busy ? "…" : "Начать игру"}
        </button>
      ) : (
        <button
          type="button"
          className="primary mines-cta"
          disabled={busy || (game?.safePickCount ?? 0) < 1}
          onClick={() => void onCashout()}
        >
          {busy ? "…" : "Забрать"}
        </button>
      )}

      {note ? <p className="error">{note}</p> : null}

      <details className="mines-advanced">
        <summary>Provably Fair</summary>
        <label className="field">
          Client seed
          <input
            value={clientSeed}
            disabled={active || busy}
            onChange={(e) => {
              setSeed(e.target.value);
              setClientSeed(e.target.value);
            }}
          />
        </label>
        {game ? (
          <button type="button" className="ghost" onClick={() => setPfOpen(true)}>
            Provably Fair
          </button>
        ) : null}
      </details>

      <ProvablyFairModal
        open={pfOpen}
        onClose={() => setPfOpen(false)}
        fields={
          game
            ? [
                { label: "Algorithm", value: game.algorithm },
                { label: "Server seed hash", value: game.serverSeedHash },
                {
                  label: "Server seed",
                  value: game.serverSeed ?? "(скрыт до завершения)",
                },
                { label: "Client seed", value: game.clientSeed },
                { label: "Nonce", value: game.nonce },
              ]
            : []
        }
      />
    </div>
  );
}

export default MinesPage;
