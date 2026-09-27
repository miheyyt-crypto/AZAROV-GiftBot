import { PrizeArt } from "../assets/PrizeArt.js";
import { CaseRoulette, CaseRouletteChip } from "../cases/CaseRoulette.js";
import { pinWinnerOnStrip } from "../cases/roulette-strip.js";
import { BottomSheet } from "../components/BottomSheet.js";
import { CoinTitle } from "../components/CoinAmount.js";
import {
  catalogItemFromOpenResult,
  formatCountdown,
  freeCaseResultCreditLine,
  rarityHeading,
  rarityLabel,
  remainingFromServer,
} from "./messages.js";
import type {
  FreeCaseCatalogItem,
  FreeCaseOpenResult,
  FreeCaseStatus,
} from "./types.js";

function groupCatalog(catalog: FreeCaseCatalogItem[]) {
  return {
    legendary: catalog.filter((item) => item.rarity === "legendary"),
    epic: catalog.filter((item) => item.rarity === "epic"),
    common: catalog.filter((item) => item.rarity === "common"),
  };
}

function prizeKindLabel(item: FreeCaseCatalogItem): string | null {
  if (item.rewardType === "azc") {
    return null;
  }
  if (item.rewardType === "gram") {
    return "Gram";
  }
  return "NFT";
}

function RouletteItem({
  item,
  stripIndex,
  winning = false,
}: {
  item: FreeCaseCatalogItem;
  stripIndex?: number;
  winning?: boolean;
}) {
  const isNft =
    item.rewardType === "external" ||
    item.imageKey.toLowerCase().includes("nft") ||
    /nft|ring|watch|bag|loot/i.test(item.title);
  return (
    <CaseRouletteChip
      className={`roulette-item rarity-${item.rarity}`}
      {...(stripIndex !== undefined ? { stripIndex } : {})}
      winning={winning}
    >
      <PrizeArt
        imageKey={item.imageKey}
        rewardType={item.rewardType}
        title={item.title}
        rarity={item.rarity}
        size="sm"
      />
      <p className="roulette-item__name case-roulette__chip-name">
        <CoinTitle title={item.title} />
      </p>
      {isNft ? <span className="roulette-item__tag">NFT</span> : null}
    </CaseRouletteChip>
  );
}

export function FreeCasePanel({
  status,
  opening = false,
  animating = false,
  result = null,
  errorNote,
  showContents = false,
  showResultModal = false,
  nowMs = Date.now(),
  fetchedAtMs,
  onOpenContents,
  onCloseContents,
  onOpen,
  onCloseResult,
  onTryPaidCases,
}: {
  status: FreeCaseStatus;
  opening?: boolean;
  animating?: boolean;
  result?: FreeCaseOpenResult | null;
  errorNote?: string;
  showContents?: boolean;
  showResultModal?: boolean;
  nowMs?: number;
  fetchedAtMs: number;
  onOpenContents: () => void;
  onCloseContents: () => void;
  onOpen: () => void;
  onCloseResult: () => void;
  onTryPaidCases: () => void;
}) {
  const remaining = remainingFromServer(
    status.nextAvailableAt,
    status.remainingSeconds,
    fetchedAtMs,
    nowMs,
  );
  const available = status.available && remaining <= 0;
  const groups = groupCatalog(status.catalog);
  const spinning = Boolean(animating && result);
  const stripPlan = spinning && result
    ? pinWinnerOnStrip(status.catalog, catalogItemFromOpenResult(result.result))
    : null;

  const idleStrip =
    status.catalog.length > 0
      ? [...status.catalog, ...status.catalog, ...status.catalog]
      : [];

  const countdownLabel = formatCountdown(remaining);
  const rouletteItems = spinning && stripPlan ? stripPlan.strip : idleStrip;

  return (
    <section className="free-case" data-case-view={spinning ? "spinning" : "idle"}>
      <header className="free-case__head">
        <h2 className="free-case__heading">БЕСПЛАТНЫЙ КЕЙС</h2>
        <p className="free-case__can-win">ВЫ МОЖЕТЕ ВЫИГРАТЬ</p>
      </header>

      <CaseRoulette
        spinning={spinning}
        items={rouletteItems}
        stopIndex={stripPlan?.stopIndex ?? null}
        {...(spinning && result
          ? {
              winnerItemCode: result.result.itemCode,
              winnerTitle: result.result.title,
              winnerType: result.result.rewardType,
            }
          : {})}
        testId="free-case-strip"
        label="Рулетка бесплатного кейса"
        renderItem={(item, index, winning) => (
          <RouletteItem
            key={`${item.itemCode}-${spinning ? index : `idle-${index}`}`}
            item={item}
            {...(spinning ? { stripIndex: index } : {})}
            winning={winning}
          />
        )}
      />
      {spinning ? <p className="case-roulette-status">Открываем кейс...</p> : null}

      <button
        type="button"
        className={
          available
            ? "primary free-case__cta"
            : "primary free-case__cta free-case__cta--cooldown"
        }
        disabled={!available || opening || animating}
        onClick={onOpen}
        data-testid="free-case-open"
      >
        {opening
          ? "Открытие…"
          : available
            ? "🔥 БЕСПЛАТНО"
            : `Следующий кейс через ${countdownLabel}`}
      </button>
      {!available ? (
        <p className="free-badge free-badge--cooldown sr-only" data-testid="free-case-countdown">
          {countdownLabel}
        </p>
      ) : null}

      {!spinning ? (
        <button type="button" className="ghost free-case__contents-btn" onClick={onOpenContents}>
          Что внутри
        </button>
      ) : null}
      {errorNote ? <p className="muted free-case__error">{errorNote}</p> : null}

      <BottomSheet
        open={showContents && !spinning}
        title="NFT кейс"
        subtitle="Что внутри"
        onClose={onCloseContents}
        className="sheet--contents"
        headRight={
          <span className="contents-odds-hint" title="Отображаемые шансы каталога">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
              <path
                d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            шансы
          </span>
        }
      >
        <div className="stack contents-sheet" data-testid="free-case-contents">
          {(
            [
              ["legendary", groups.legendary, status.displayTotals.legendary],
              ["epic", groups.epic, status.displayTotals.epic],
              ["common", groups.common, status.displayTotals.common],
            ] as const
          ).map(([rarity, items, total]) => (
            <section
              key={rarity}
              className={`contents-rarity contents-rarity--${rarity}`}
            >
              <header className="contents-rarity__head">
                <div>
                  <p className={`contents-group__title rarity-label-${rarity}`}>
                    {rarityHeading(rarity)}
                  </p>
                  <p className="sr-only">
                    {rarityLabel(rarity)} · {total}%
                  </p>
                  <p className="muted contents-rarity__meta">
                    {items.length}{" "}
                    {items.length === 1
                      ? "подарок"
                      : items.length < 5
                        ? "подарка"
                        : "подарков"}
                    {items.length > 0
                      ? ` · у каждого ${items.map((i) => i.displayChance)[0] ?? "—"}%`
                      : ""}
                  </p>
                </div>
                <span className="contents-rarity__total">{total}%</span>
              </header>
              <div className="contents-grid">
                {items.map((item) => (
                  <article key={item.itemCode} className="contents-card">
                    <PrizeArt
                      imageKey={item.imageKey}
                      rewardType={item.rewardType}
                      title={item.title}
                      rarity={item.rarity}
                      size="md"
                    />
                    <p className="contents-card__title">
                      <CoinTitle title={item.title} />
                    </p>
                    {prizeKindLabel(item) ? (
                      <p className="contents-card__kind">{prizeKindLabel(item)}</p>
                    ) : null}
                    <p className="sr-only">Шанс {item.displayChance}%</p>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet
        open={showResultModal && Boolean(result)}
        title="РЕЗУЛЬТАТ СПИНА"
        onClose={onCloseResult}
      >
        {result ? (
          <div
            className="stack result-modal"
            data-testid="free-case-result"
            data-opening-id={result.openingId}
            data-winner={result.result.itemCode}
            data-winner-title={result.result.title}
            data-winner-type={result.result.rewardType}
          >
            <p className="result-modal__eyebrow">РЕЗУЛЬТАТ СПИНА</p>
            <p className="result-modal__title">Поздравляем!</p>
            <div className={`result-modal__prize rarity-${result.result.rarity}`}>
              <PrizeArt
                imageKey={result.result.imageKey}
                rewardType={result.result.rewardType}
                rarity={result.result.rarity}
                size="lg"
              />
            </div>
            <p className="result-modal__name">
              <CoinTitle title={result.result.title} />
            </p>
            <p className="muted">Ты выиграл</p>
            <p className="result-modal__pill">
              <PrizeArt
                imageKey={result.result.imageKey}
                rewardType={result.result.rewardType}
                rarity={result.result.rarity}
                size="sm"
              />
              <CoinTitle title={result.result.title} />
            </p>
            <div className="result-modal__upsell">
              <p className="mini-row__title">Хочешь шанс на приз больше?</p>
              <p className="muted">
                Попробуй кейсы за монеты. Более ценные призы уже ждут тебя!
              </p>
              <button type="button" className="primary primary--neon" onClick={onTryPaidCases}>
                Открыть сейчас
              </button>
              <p className="result-modal__credited ok">
                {freeCaseResultCreditLine(result.result.rewardType)}
              </p>
              <p className="muted">Награда уже начислена или добавлена в инвентарь.</p>
            </div>
            <button type="button" className="ghost" onClick={onCloseResult}>
              Закрыть
            </button>
          </div>
        ) : null}
      </BottomSheet>
    </section>
  );
}
