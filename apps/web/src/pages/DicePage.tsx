import { useEffect, useState, type CSSProperties } from "react";
import {
  ApiRequestError,
  loadDiceHistory,
  playDiceApi,
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
import { DiceLossIcon, DiceMarkIcon, DiceWinIcon } from "../games/dice-icons.js";
import {
  clampDiceBet,
  clampDiceChance,
  DICE_CHANCE_MAX,
  DICE_CHANCE_MIN,
  DICE_MAX_BET,
  DICE_MIN_BET,
  DICE_QUICK_BETS,
  diceMultiplierPreview,
  dicePotentialPayout,
} from "../games/dice-ui.js";
import { ProvablyFairModal } from "../games/ProvablyFairModal.js";
import type { DiceRound } from "../games/types.js";

function friendlyError(code?: string): string {
  switch (code) {
    case "INSUFFICIENT_BALANCE":
      return "Недостаточно монет";
    case "DICE_BET_OUT_OF_RANGE":
      return "Ставка от 100 до 10 000";
    case "DICE_INVALID_CHANCE":
      return "Шанс 1–95%";
    default:
      return "Не удалось бросить кубик";
  }
}

export function DicePage({
  token,
  skipRemote = false,
  fixtureRound = null,
}: {
  token: string;
  skipRemote?: boolean;
  fixtureRound?: DiceRound | null;
}) {
  const [bet, setBet] = useState(100);
  const [chance, setChance] = useState(50);
  const [clientSeed, setSeed] = useState(() => getOrCreateClientSeed());
  const [last, setLast] = useState<DiceRound | null>(fixtureRound);
  const [history, setHistory] = useState<DiceRound[]>([]);
  const [busy, setBusy] = useState(false);
  const [toss, setToss] = useState(false);
  const [note, setNote] = useState<string | undefined>();
  const [pfOpen, setPfOpen] = useState(false);
  const balanceAzc = useAzcBalance(token, skipRemote);
  const wallet = Number(balanceAzc) || 0;

  useEffect(() => {
    if (skipRemote) {
      return;
    }
    let cancelled = false;
    void loadDiceHistory(token)
      .then((res) => {
        if (!cancelled) {
          setHistory(res.items);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token, skipRemote]);

  useEffect(() => {
    if (!last) {
      return;
    }
    setToss(true);
    const id = window.setTimeout(() => setToss(false), 480);
    return () => {
      window.clearTimeout(id);
    };
  }, [last?.id]);

  async function onPlay(): Promise<void> {
    if (busy || skipRemote) {
      return;
    }
    if (bet < DICE_MIN_BET) {
      setNote("Минимальная ставка — 100 монет");
      return;
    }
    if (bet > DICE_MAX_BET) {
      setNote(friendlyError("DICE_BET_OUT_OF_RANGE"));
      return;
    }
    if (wallet > 0 && bet > wallet) {
      setNote("Недостаточно монет");
      return;
    }
    setBusy(true);
    setNote(undefined);
    const route = "POST /games/dice/play";
    try {
      const result = await playDiceApi(
        token,
        { betAzc: bet, chance: clampDiceChance(chance), clientSeed },
        keyForPost(route),
      );
      clearIdempotencyKey(route);
      setLast(result.round);
      setHistory((prev) => [result.round, ...prev].slice(0, 20));
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

  const previewChance = clampDiceChance(chance);
  const mult = diceMultiplierPreview(previewChance);
  const potential = dicePotentialPayout(bet, previewChance);

  return (
    <div className="stack dice-page">
      <div className="dice-atmosphere" aria-hidden="true" />
      <PageHeader
        title="Dice"
        backHref="#/"
        align="start"
        icon={<DiceMarkIcon size={18} />}
        trailing={<BalanceBadge amountAzcString={balanceAzc} />}
      />

      <section className="dice-hero-wrap">
        <div className={`dice-hero${toss ? " is-toss" : ""}`} aria-hidden="true">
          <span className="dice-hero__face">
            <span />
            <span />
            <span />
            <span />
            <span />
          </span>
        </div>
        <p className="dice-hero__label">ВЫПАЛО</p>
        <p
          className={`dice-hero__result${
            last ? (last.win ? " is-win" : " is-loss") : ""
          }`}
        >
          {last ? last.displayResult : "—"}
        </p>
      </section>

      <section className="dice-stats">
        <article className="dice-stats__chance">
          <p>ШАНС</p>
          <strong>{previewChance}%</strong>
        </article>
        <article className="dice-stats__mult">
          <p>МНОЖИТЕЛЬ</p>
          <strong>×{mult}</strong>
        </article>
      </section>

      <div className="dice-chance">
        <div className="dice-chance__head">
          <span>Шанс</span>
          <strong>{previewChance}%</strong>
        </div>
        <div
          className="dice-slider"
          style={{ "--dice-p": (previewChance - DICE_CHANCE_MIN) / (DICE_CHANCE_MAX - DICE_CHANCE_MIN) } as CSSProperties}
        >
          <span className="dice-slider__bubble" aria-hidden="true">
            {previewChance}%
          </span>
          <div className="dice-slider__rail">
            <div className="dice-slider__track" aria-hidden="true">
              <span className="dice-slider__fill" />
            </div>
            <input
              type="range"
              min={DICE_CHANCE_MIN}
              max={DICE_CHANCE_MAX}
              value={previewChance}
              disabled={busy}
              aria-label="Шанс"
              onChange={(e) => setChance(clampDiceChance(Number(e.target.value)))}
            />
          </div>
          <div className="dice-slider__ends" aria-hidden="true">
            <span>1%</span>
            <span>95%</span>
          </div>
        </div>
      </div>

      <p className="dice-potential">
        <span>Возможный выигрыш</span>
        <CoinAmount amount={String(potential)} size={14} />
      </p>

      {last ? (
        <section className={last.win ? "dice-result is-win" : "dice-result is-loss"}>
          <p className="dice-result__title">
            {last.win ? <DiceWinIcon size={15} /> : <DiceLossIcon size={15} />}
            {last.win ? "Победа" : "Не повезло"}
          </p>
          <CoinAmount amount={last.payoutAzc} size={15} sign={last.win ? "plus" : "none"} />
        </section>
      ) : null}

      <section className="dice-panel">
        <p className="dice-panel__label">СУММА СТАВКИ</p>
        <div className="dice-bet-row">
          <button
            type="button"
            className="dice-chip"
            disabled={busy}
            onClick={() => setBet((value) => clampDiceBet(Math.floor(value / 2)))}
          >
            ½
          </button>
          <button
            type="button"
            className="dice-chip"
            disabled={busy}
            onClick={() => setBet((value) => clampDiceBet(value * 2))}
          >
            2×
          </button>
          <label className="dice-amount">
            <input
              type="number"
              min={DICE_MIN_BET}
              max={DICE_MAX_BET}
              step={1}
              value={bet}
              disabled={busy}
              onChange={(e) => {
                const next = Math.floor(Number(e.target.value));
                setBet(Number.isFinite(next) ? next : 0);
              }}
            />
            <IconCoin size={15} />
          </label>
          <button
            type="button"
            className="dice-chip"
            disabled={busy}
            onClick={() => {
              const cap = Math.max(DICE_MIN_BET, Math.min(DICE_MAX_BET, wallet || DICE_MAX_BET));
              setBet(clampDiceBet(cap));
            }}
          >
            МАКС
          </button>
        </div>
        <div className="dice-quick">
          {DICE_QUICK_BETS.map((amount) => {
            const unaffordable = wallet > 0 && wallet < amount;
            return (
              <button
                key={amount}
                type="button"
                className={
                  bet === amount
                    ? "dice-chip is-active"
                    : unaffordable
                      ? "dice-chip is-muted"
                      : "dice-chip"
                }
                disabled={busy || unaffordable}
                onClick={() => setBet(amount)}
              >
                {groupDigits(String(amount))}
              </button>
            );
          })}
        </div>
      </section>

      <button
        type="button"
        className="primary dice-cta"
        disabled={busy || skipRemote}
        onClick={() => void onPlay()}
      >
        {busy ? "…" : "Бросить"}
      </button>
      {note ? <p className="error">{note}</p> : null}

      <section className="dice-history">
        <h2>История</h2>
        {history.length === 0 ? (
          <p className="muted">Пока пусто</p>
        ) : (
          history.slice(0, 8).map((row) => (
            <article key={row.id} className={row.win ? "dice-history__row is-win" : "dice-history__row is-loss"}>
              <span className="dice-history__meta">
                {row.win ? <DiceWinIcon size={14} /> : <DiceLossIcon size={14} />}
                <span>
                  <b>{row.win ? "Победа" : "Проигрыш"}</b>
                  <em>{row.displayResult}</em>
                </span>
              </span>
              <CoinAmount amount={row.payoutAzc} size={13} />
            </article>
          ))
        )}
      </section>

      <details className="dice-advanced">
        <summary>Client seed / Provably Fair</summary>
        <label className="field">
          Client seed
          <input
            value={clientSeed}
            disabled={busy}
            onChange={(e) => {
              setSeed(e.target.value);
              setClientSeed(e.target.value);
            }}
          />
        </label>
        {last ? (
          <button type="button" className="ghost" onClick={() => setPfOpen(true)}>
            Provably Fair
          </button>
        ) : null}
      </details>

      <ProvablyFairModal
        open={pfOpen}
        onClose={() => setPfOpen(false)}
        fields={
          last
            ? [
                { label: "Algorithm", value: last.algorithm },
                { label: "Server seed hash", value: last.serverSeedHash },
                { label: "Server seed", value: last.serverSeed },
                { label: "Client seed", value: last.clientSeed },
                { label: "Nonce", value: last.nonce },
                { label: "Raw result", value: String(last.rawResult) },
              ]
            : []
        }
      />
    </div>
  );
}

export default DicePage;
