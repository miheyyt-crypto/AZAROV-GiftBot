import { CaseChipArt } from "../cases/CaseChipArt.js";
import { CaseRoulette, CaseRouletteChip } from "../cases/CaseRoulette.js";
import { pinWinnerOnStrip } from "../cases/roulette-strip.js";
import { BottomSheet } from "../components/BottomSheet.js";
import { CoinAmount, CoinTitle } from "../components/CoinAmount.js";
import { groupDigits } from "../lib/format.js";
import { ShopCaseHeroArt } from "../shop/ShopArt.js";
import { azcDeficit, canAffordAzc, caseTitle } from "../shop/shop-ui.js";
import { paidCaseResultCopy } from "./messages.js";
import {
  PAID_CASE_TAGLINE,
  paidCaseRarityLabel,
  paidCaseRewardRarity,
  paidCaseRewardTitle,
} from "./paid-case-ui.js";
import { PaidRewardArt } from "./RewardArt.js";
import type {
  PaidCaseCatalog,
  PaidCaseCatalogItem,
  PaidCaseOpenResult,
} from "./types.js";

function asCatalogItem(
  result: PaidCaseOpenResult["result"],
): PaidCaseCatalogItem {
  return {
    itemCode: result.itemCode,
    title: result.title,
    rewardType: result.rewardType,
    rewardAmount: result.rewardAmount ?? result.rewardAmountRub ?? "0",
    realChance: result.realChance,
    displayChance: result.displayChance,
    imageKey: result.imageKey,
  };
}

export function PaidCaseSheet({
  paidCase,
  balanceAzc = "0",
  opening = false,
  animating = false,
  result = null,
  errorNote,
  showResultModal = false,
  onClose,
  onOpen,
  onCloseResult,
}: {
  paidCase: PaidCaseCatalog | null;
  balanceAzc?: string;
  opening?: boolean;
  animating?: boolean;
  result?: PaidCaseOpenResult | null;
  errorNote?: string;
  showResultModal?: boolean;
  onClose: () => void;
  onOpen: () => void;
  onCloseResult: () => void;
}) {
  const spinning = Boolean(animating && result && paidCase);
  const stripPlan =
    spinning && result && paidCase
      ? pinWinnerOnStrip(paidCase.items, asCatalogItem(result.result))
      : null;

  const affordable = paidCase ? canAffordAzc(balanceAzc, paidCase.priceAzc) : false;
  const missing = paidCase ? azcDeficit(balanceAzc, paidCase.priceAzc) : 0n;
  const busy = opening || animating;
  const canOpen = Boolean(paidCase) && affordable && !busy;

  return (
    <>
      <BottomSheet
        open={Boolean(paidCase) && !showResultModal}
        title={paidCase ? caseTitle(paidCase.title) : "Кейс"}
        onClose={onClose}
        className={
          spinning ? "sheet--paid-case sheet--case-spinning" : "sheet--paid-case"
        }
      >
        {paidCase ? (
          spinning && stripPlan && result ? (
            <div
              className="paid-case-sheet paid-case-sheet--spinning"
              data-testid="paid-case-sheet"
              data-case-view="spinning"
            >
              <CaseRoulette
                spinning
                items={stripPlan.strip}
                stopIndex={stripPlan.stopIndex}
                winnerItemCode={result.result.itemCode}
                winnerTitle={result.result.title}
                winnerType={result.result.rewardType}
                testId="paid-case-strip"
                label="Открытие кейса"
                renderItem={(item, index, winning) => {
                  const rarity = paidCaseRewardRarity(item, paidCase.items);
                  return (
                    <CaseRouletteChip
                      key={`${item.itemCode}-${index}`}
                      className={`rarity-${rarity}`}
                      stripIndex={index}
                      winning={winning}
                    >
                      <CaseChipArt
                        rewardType={item.rewardType}
                        imageKey={item.imageKey}
                        title={paidCaseRewardTitle(item, paidCase.items)}
                        rarity={rarity}
                        amount={item.rewardAmount}
                      />
                      <p className="case-roulette__chip-name">
                        <CoinTitle title={paidCaseRewardTitle(item, paidCase.items)} />
                      </p>
                    </CaseRouletteChip>
                  );
                }}
              />
              <p className="case-roulette-status">Открываем кейс...</p>
            </div>
          ) : (
            <div
              className="paid-case-sheet"
              data-testid="paid-case-sheet"
              data-case-view="idle"
            >
              <section className={`paid-case-hero paid-case-hero--${paidCase.code}`}>
                <ShopCaseHeroArt code={paidCase.code} />
                <p className="paid-case-hero__tagline">{PAID_CASE_TAGLINE[paidCase.code]}</p>
              </section>

              <div className="paid-case-section">
                <h3>
                  <span className="paid-case-section__accent" aria-hidden="true" />
                  Что внутри
                </h3>
              </div>

              <div className="paid-case-grid" data-testid="paid-case-contents">
                {paidCase.items.map((item) => {
                  const rarity = paidCaseRewardRarity(item, paidCase.items);
                  return (
                    <article
                      key={item.itemCode}
                      className={`paid-reward paid-reward--${rarity}`}
                      data-testid={`paid-reward-${item.itemCode}`}
                    >
                      <div className="paid-reward__frame">
                        <div className="paid-reward__art">
                          <PaidRewardArt
                            rewardType={item.rewardType}
                            amount={item.rewardAmount}
                            rarity={rarity}
                          />
                        </div>
                        <div className="paid-reward__meta">
                          <p className="paid-reward__title">
                            {paidCaseRewardTitle(item, paidCase.items)}
                          </p>
                          <p className="paid-reward__rarity">{paidCaseRarityLabel(rarity)}</p>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="paid-case-buy">
                {!affordable ? (
                  <p className="paid-case-deficit" data-testid="paid-case-deficit">
                    Нужно ещё {groupDigits(missing.toString())} монет
                  </p>
                ) : null}
                <button
                  type="button"
                  className={
                    canOpen ? "paid-case-cta" : "paid-case-cta paid-case-cta--disabled"
                  }
                  disabled={!canOpen}
                  onClick={onOpen}
                  data-testid="paid-case-open"
                >
                  {opening ? (
                    "Открытие…"
                  ) : affordable ? (
                    <>
                      Открыть за <CoinAmount amount={paidCase.priceAzc} />
                    </>
                  ) : (
                    "Не хватает монет"
                  )}
                </button>
                {errorNote ? <p className="muted">{errorNote}</p> : null}
              </div>
            </div>
          )
        ) : null}
      </BottomSheet>

      <BottomSheet
        open={showResultModal && Boolean(result)}
        title="РЕЗУЛЬТАТ"
        onClose={onCloseResult}
        className="sheet--shop-product"
      >
        {result ? (
          <div
            className="stack"
            data-testid="paid-case-result"
            data-opening-id={result.openingId}
            data-winner={result.result.itemCode}
          >
            <p className="mini-row__title">Поздравляем!</p>
            <div className="item-chip rarity-common item-chip--lg">
              <PaidRewardArt
                rewardType={result.result.rewardType}
                amount={result.result.rewardAmount ?? result.result.rewardAmountRub ?? "0"}
                rarity={
                  paidCase
                    ? paidCaseRewardRarity(asCatalogItem(result.result), paidCase.items)
                    : "common"
                }
              />
            </div>
            <p>
              Ты выиграл:{" "}
              <strong>
                <CoinTitle
                  title={paidCaseRewardTitle(asCatalogItem(result.result), paidCase?.items)}
                />
              </strong>
            </p>
            <p className="muted">{paidCaseResultCopy(result.result.rewardType)}</p>
            {result.result.rewardType === "cash_rub" ? (
              <a className="primary" href="#/profile/inventory">
                Открыть инвентарь
              </a>
            ) : null}
          </div>
        ) : null}
      </BottomSheet>
    </>
  );
}
