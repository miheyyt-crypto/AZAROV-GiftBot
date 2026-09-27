import { CaseChipArt } from "../cases/CaseChipArt.js";
import { CaseRoulette, CaseRouletteChip } from "../cases/CaseRoulette.js";
import { pinWinnerOnStrip } from "../cases/roulette-strip.js";
import { BottomSheet } from "../components/BottomSheet.js";
import { CoinTitle } from "../components/CoinAmount.js";
import { PaidRewardArt } from "../paid-case/RewardArt.js";
import { ShopCaseHeroArt } from "../shop/ShopArt.js";
import { caseTitle } from "../shop/shop-ui.js";
import { referralCaseResultCopy } from "./messages.js";
import {
  REFERRAL_CASE_TAGLINE,
  referralRarityLabel,
  referralRewardRarity,
  referralRewardTitle,
} from "./referral-case-ui.js";
import type {
  ReferralCaseCatalog,
  ReferralCaseCatalogItem,
  ReferralCaseOpenResult,
} from "./types.js";

function resultAmount(result: ReferralCaseOpenResult["result"]): string {
  return result.rewardAmount ?? result.rewardAmountRub ?? "0";
}

function resultToCatalogItem(
  result: ReferralCaseOpenResult["result"],
): ReferralCaseCatalogItem {
  return {
    itemCode: result.itemCode,
    title: result.title,
    rewardType: result.rewardType,
    rewardAmount: resultAmount(result),
    displayChance: result.displayChance ?? null,
    imageKey: result.imageKey,
  };
}

export function ReferralCaseSheet({
  catalog,
  availableCases,
  opening = false,
  animating = false,
  result = null,
  errorNote,
  showResultModal = false,
  onClose,
  onOpen,
  onCloseResult,
}: {
  catalog: ReferralCaseCatalog | null;
  availableCases: number;
  opening?: boolean;
  animating?: boolean;
  result?: ReferralCaseOpenResult | null;
  errorNote?: string;
  showResultModal?: boolean;
  onClose: () => void;
  onOpen: () => void;
  onCloseResult: () => void;
}) {
  const canOpen = availableCases > 0;
  const busy = opening || animating;
  const spinning = Boolean(animating && result && catalog);
  const stripPlan =
    spinning && result && catalog
      ? pinWinnerOnStrip(catalog.items, resultToCatalogItem(result.result))
      : null;

  const resultTitle = result
    ? referralRewardTitle(
        {
          rewardType: result.result.rewardType,
          rewardAmount: resultAmount(result.result),
        },
        catalog?.items ?? [],
      )
    : "";

  return (
    <>
      <BottomSheet
        open={Boolean(catalog) && !showResultModal}
        title={catalog ? caseTitle(catalog.title) : "Реферальный кейс"}
        onClose={onClose}
        className={
          spinning ? "sheet--paid-case sheet--case-spinning" : "sheet--paid-case"
        }
      >
        {catalog ? (
          spinning && stripPlan && result ? (
            <div
              className="paid-case-sheet paid-case-sheet--spinning"
              data-testid="referral-case-sheet"
              data-case-view="spinning"
            >
              <CaseRoulette
                spinning
                items={stripPlan.strip}
                stopIndex={stripPlan.stopIndex}
                winnerItemCode={result.result.itemCode}
                winnerTitle={result.result.title}
                winnerType={result.result.rewardType}
                testId="referral-case-strip"
                label="Открытие кейса"
                renderItem={(item, index, winning) => {
                  const rarity = referralRewardRarity(item, catalog.items);
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
                        title={referralRewardTitle(item, catalog.items)}
                        rarity={rarity}
                        amount={item.rewardAmount}
                      />
                      <p className="case-roulette__chip-name">
                        <CoinTitle title={referralRewardTitle(item, catalog.items)} />
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
              data-testid="referral-case-sheet"
              data-case-view="idle"
            >
              <section className="paid-case-hero paid-case-hero--referral">
                <ShopCaseHeroArt code="referral" />
                <p className="paid-case-hero__tagline">{REFERRAL_CASE_TAGLINE}</p>
              </section>

              <div className="paid-case-section">
                <h3>
                  <span className="paid-case-section__accent" aria-hidden="true" />
                  Что внутри
                </h3>
              </div>

              <div className="paid-case-grid" data-testid="referral-case-contents">
                {catalog.items.map((item) => {
                  const rarity = referralRewardRarity(item, catalog.items);
                  return (
                    <article
                      key={item.itemCode}
                      className={`paid-reward paid-reward--${rarity}`}
                      data-testid={`referral-reward-${item.itemCode}`}
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
                            {referralRewardTitle(item, catalog.items)}
                          </p>
                          <p className="paid-reward__rarity">{referralRarityLabel(rarity)}</p>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="paid-case-buy">
                <p className="paid-case-stock" data-testid="referral-case-available">
                  Доступно кейсов: {availableCases}
                </p>
                <button
                  type="button"
                  className={
                    canOpen && !busy
                      ? "paid-case-cta"
                      : "paid-case-cta paid-case-cta--disabled"
                  }
                  disabled={!canOpen || busy}
                  onClick={onOpen}
                  data-testid="referral-case-open"
                >
                  {opening ? "Открытие…" : canOpen ? "Открыть" : "Нет кейсов"}
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
            data-testid="referral-case-result"
            data-opening-id={result.openingId}
            data-winner={result.result.itemCode}
          >
            <p className="mini-row__title">Поздравляем!</p>
            <div className="item-chip rarity-common item-chip--lg">
              <PaidRewardArt
                rewardType={result.result.rewardType}
                amount={resultAmount(result.result)}
                rarity={
                  catalog
                    ? referralRewardRarity(resultToCatalogItem(result.result), catalog.items)
                    : "common"
                }
              />
            </div>
            <p>
              Ты выиграл:{" "}
              <strong>
                <CoinTitle title={resultTitle} />
              </strong>
            </p>
            <p className="muted">{referralCaseResultCopy(result.result.rewardType)}</p>
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
