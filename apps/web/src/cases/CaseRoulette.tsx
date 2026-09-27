import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  CASE_ROULETTE_ANIMATION_MS,
  CASE_ROULETTE_EASING,
  ROULETTE_GAP,
  ROULETTE_ITEM_WIDTH,
  type RouletteCoded,
  rouletteCenterOffsetPx,
  rouletteSpinTransform,
} from "./roulette-strip.js";

export function useCaseRouletteOffset(
  spinning: boolean,
  stopIndex: number | null,
): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (!spinning || stopIndex === null) {
      setOffset(0);
      return;
    }
    const frame = requestAnimationFrame(() => {
      setOffset(rouletteCenterOffsetPx(stopIndex));
    });
    return () => cancelAnimationFrame(frame);
  }, [spinning, stopIndex]);
  return offset;
}

const CHIP_BOX: CSSProperties = {
  width: ROULETTE_ITEM_WIDTH,
  minWidth: ROULETTE_ITEM_WIDTH,
  maxWidth: ROULETTE_ITEM_WIDTH,
  flexGrow: 0,
  flexShrink: 0,
  flexBasis: ROULETTE_ITEM_WIDTH,
  marginRight: 0,
};

export function CaseRouletteChip({
  children,
  className,
  stripIndex,
  winning = false,
}: {
  children: ReactNode;
  className?: string;
  stripIndex?: number;
  winning?: boolean;
}) {
  return (
    <div
      className={["case-roulette__chip", className].filter(Boolean).join(" ")}
      style={CHIP_BOX}
      data-chip-width={String(ROULETTE_ITEM_WIDTH)}
      data-chip-gap={String(ROULETTE_GAP)}
      {...(stripIndex !== undefined ? { "data-strip-index": String(stripIndex) } : {})}
      {...(winning ? { "data-strip-winner": "true" } : {})}
    >
      {children}
    </div>
  );
}

export function CaseRoulette<T extends RouletteCoded>({
  spinning,
  items,
  stopIndex = null,
  winnerItemCode,
  winnerTitle,
  winnerType,
  testId,
  label,
  renderItem,
}: {
  spinning: boolean;
  items: readonly T[];
  stopIndex?: number | null;
  winnerItemCode?: string;
  winnerTitle?: string;
  winnerType?: string;
  testId: string;
  label: string;
  renderItem: (item: T, index: number, winning: boolean) => ReactNode;
}) {
  const offsetPx = useCaseRouletteOffset(spinning, spinning ? stopIndex : null);
  const trackClass = spinning
    ? "case-roulette__track case-roulette__track--spin"
    : "case-roulette__track case-roulette__track--idle";
  const trackStyle: CSSProperties = spinning
    ? {
        gap: ROULETTE_GAP,
        transform: rouletteSpinTransform(offsetPx),
        transitionDuration: `${CASE_ROULETTE_ANIMATION_MS}ms`,
        transitionTimingFunction: CASE_ROULETTE_EASING,
      }
    : { gap: ROULETTE_GAP };

  return (
    <div className="case-roulette" aria-label={label} data-testid="case-roulette">
      <span className="case-roulette__pointer case-roulette__pointer--top" aria-hidden="true" />
      <span className="case-roulette__pointer case-roulette__pointer--bottom" aria-hidden="true" />
      <div className="case-roulette__viewport">
        <div
          className={trackClass}
          style={trackStyle}
          data-testid={testId}
          {...(winnerItemCode ? { "data-winner": winnerItemCode } : {})}
          {...(winnerTitle ? { "data-winner-title": winnerTitle } : {})}
          {...(winnerType ? { "data-winner-type": winnerType } : {})}
          {...(spinning && stopIndex !== null
            ? { "data-stop-index": String(stopIndex) }
            : {})}
        >
          {items.map((item, index) =>
            renderItem(item, index, spinning && stopIndex === index),
          )}
        </div>
      </div>
    </div>
  );
}
