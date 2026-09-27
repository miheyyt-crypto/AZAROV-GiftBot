/**
 * Predetermined case roulette: decorative neighbors may repeat the catalog,
 * but the chip under the center pointer is always the backend winner.
 *
 * Chip size is the same in TS and CSS (`ROULETTE_ITEM_WIDTH` / `ROULETTE_GAP`).
 * Track layout: `left: 50%` of the viewport, then
 * `transform: translate3d(-offsetPx, 0, 0)` where
 * `offsetPx = stopIndex * stride + itemWidth / 2`.
 * Do not use `translateX(-stopIndex * width)` (left-aligns a neighbor under the pin).
 * Do not use `translateX(calc(50% - offset))` on the track — CSS % in transform
 * is the track's own width, not the viewport.
 */

export const ROULETTE_ITEM_WIDTH = 84;
export const ROULETTE_GAP = 12;
export const ROULETTE_STRIDE = ROULETTE_ITEM_WIDTH + ROULETTE_GAP;
export const CASE_ROULETTE_ANIMATION_MS = 6200;
export const CASE_ROULETTE_RESULT_PAUSE_MS = 400;
export const CASE_ROULETTE_OPEN_SEQUENCE_MS =
  CASE_ROULETTE_ANIMATION_MS + CASE_ROULETTE_RESULT_PAUSE_MS;
export const CASE_ROULETTE_EASING = "cubic-bezier(0.12, 0.82, 0.08, 1)";

export function rouletteSpinTransform(offsetPx: number): string {
  return `translate3d(-${offsetPx}px, 0, 0)`;
}

export type RouletteCoded = { itemCode: string };

export function pinWinnerOnStrip<T extends RouletteCoded>(
  catalog: readonly T[],
  winner: T,
  loops = 4,
): { strip: T[]; stopIndex: number } {
  const base = catalog.length > 0 ? [...catalog] : [winner];
  const strip: T[] = [];
  for (let i = 0; i < loops; i += 1) {
    strip.push(...base);
  }
  const stopIndex = strip.length;
  strip.push(winner);
  const tail = base.filter((item) => item.itemCode !== winner.itemCode).slice(0, 4);
  strip.push(...(tail.length > 0 ? tail : base.slice(0, 3)));
  return { strip, stopIndex };
}

/** Distance from track origin to the visual center of `strip[stopIndex]`. */
export function rouletteCenterOffsetPx(
  stopIndex: number,
  stride = ROULETTE_STRIDE,
  itemWidth = ROULETTE_ITEM_WIDTH,
): number {
  return stopIndex * stride + itemWidth / 2;
}

/**
 * Which strip index sits under a centered pointer after
 * `left: 50%` + `translate3d(-offsetPx, 0, 0)`. Independent of viewport width.
 */
export function stripIndexUnderCenterPointer(
  offsetPx: number,
  stride = ROULETTE_STRIDE,
  itemWidth = ROULETTE_ITEM_WIDTH,
): number {
  const pointerInTrack = offsetPx;
  const itemLeft = pointerInTrack - itemWidth / 2;
  return Math.round(itemLeft / stride);
}

export function pointerCenterX(viewportWidth: number): number {
  return viewportWidth / 2;
}

/** Chip center in viewport space after the spin transform. */
export function chipCenterX(
  index: number,
  offsetPx: number,
  viewportWidth: number,
  stride = ROULETTE_STRIDE,
  itemWidth = ROULETTE_ITEM_WIDTH,
): number {
  const trackOrigin = viewportWidth / 2 - offsetPx;
  return trackOrigin + index * stride + itemWidth / 2;
}
