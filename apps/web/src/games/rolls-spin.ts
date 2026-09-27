/** Canonical visual + client fallback; server `ROLLS_SPIN_MS` / DTO is authoritative. */
export const ROLLS_SPIN_DURATION_MS = 8000;
export const ROLLS_RESULT_DELAY_MS = 220;
/** Full rotations before landing (display-only; does not affect winner). */
export const ROLLS_SPIN_EXTRA_TURNS = 6;

export function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/**
 * Linear elapsed fraction from the synchronized wall clock.
 * `nowMs` must be Date.now()-compatible, not rAF performance.now().
 */
export function spinLinearProgress(
  nowMs: number,
  spinStartedAtMs: number,
  durationMs: number,
  clockOffsetMs = 0,
): number {
  if (durationMs <= 0) {
    return 1;
  }
  const elapsed = nowMs + clockOffsetMs - spinStartedAtMs;
  return clamp01(elapsed / durationMs);
}

/**
 * Fast after a short ease-in (~440ms of 8s), then long deceleration.
 * Last ~1.5s still move (not a dead stop at t=4s).
 */
export function spinEase(t: number): number {
  const x = clamp01(t);
  const accelEnd = 0.055;
  if (x <= accelEnd) {
    const u = x / accelEnd;
    return 0.06 * u * u;
  }
  const q = (x - accelEnd) / (1 - accelEnd);
  return 0.06 + 0.94 * (1 - (1 - q) ** 1.85);
}

/** @deprecated use spinLinearProgress + spinEase */
export function spinProgress(
  nowMs: number,
  spinStartedAtMs: number,
  durationMs: number,
  clockOffsetMs = 0,
): number {
  return spinEase(
    spinLinearProgress(nowMs, spinStartedAtMs, durationMs, clockOffsetMs),
  );
}

export function shouldShowRollsResult(linearProgress: number): boolean {
  return linearProgress >= 1;
}

export function winnerMidAngle(
  winnerIndex: number,
  sectorAngles: number[],
): number {
  let start = 0;
  for (let i = 0; i < winnerIndex; i += 1) {
    start += sectorAngles[i] ?? 0;
  }
  const span = sectorAngles[winnerIndex] ?? 0;
  return start + span / 2;
}

/**
 * Target wheel rotation (radians) so winner sector center sits under top pointer.
 * Sectors are drawn clockwise from -PI/2 (top).
 */
export function targetRotationForWinner(input: {
  winnerIndex: number;
  sectorAngles: number[];
  extraTurns?: number;
}): number {
  const extra = input.extraTurns ?? ROLLS_SPIN_EXTRA_TURNS;
  const mid = winnerMidAngle(input.winnerIndex, input.sectorAngles);
  return extra * Math.PI * 2 - mid;
}

/** Always spin forward from the current visual angle (no snap to 0). */
export function forwardSpinTarget(input: {
  from: number;
  winnerIndex: number;
  sectorAngles: number[];
  extraTurns?: number;
}): number {
  const extra = input.extraTurns ?? ROLLS_SPIN_EXTRA_TURNS;
  const twoPi = Math.PI * 2;
  const mid = winnerMidAngle(input.winnerIndex, input.sectorAngles);
  const aligned = (((-mid) % twoPi) + twoPi) % twoPi;
  const fromNorm = ((input.from % twoPi) + twoPi) % twoPi;
  let ahead = aligned - fromNorm;
  if (ahead < 0) {
    ahead += twoPi;
  }
  return input.from + extra * twoPi + ahead;
}

export function interpolatedRotation(
  from: number,
  to: number,
  linearProgress: number,
): number {
  return from + (to - from) * spinEase(linearProgress);
}

export function countdownSecondsLeft(
  deadlineIso: string | null,
  nowMs: number,
  clockOffsetMs: number,
): number | null {
  if (!deadlineIso) {
    return null;
  }
  const deadline = Date.parse(deadlineIso);
  if (!Number.isFinite(deadline)) {
    return null;
  }
  return Math.max(0, Math.ceil((deadline - (nowMs + clockOffsetMs)) / 1000));
}

export function shouldIgnoreStaleVersion(
  localVersion: string | null,
  incomingVersion: string,
): boolean {
  if (!localVersion) {
    return false;
  }
  try {
    return BigInt(incomingVersion) < BigInt(localVersion);
  } catch {
    return false;
  }
}

export type RollsHubView =
  | { kind: "waiting" }
  | { kind: "betting"; seconds: number }
  | { kind: "spinning" }
  | { kind: "resolved" };

export function rollsHubView(
  round:
    | { status: string; participantCount: number }
    | null
    | undefined,
  countdownSeconds: number | null,
): RollsHubView {
  if (!round) {
    return { kind: "waiting" };
  }
  if (round.status === "spinning") {
    return { kind: "spinning" };
  }
  if (round.status === "resolved") {
    return { kind: "resolved" };
  }
  if (round.status === "betting" && round.participantCount >= 2) {
    return { kind: "betting", seconds: Math.max(0, countdownSeconds ?? 0) };
  }
  return { kind: "waiting" };
}

export function rollsHubAriaLabel(view: RollsHubView): string {
  switch (view.kind) {
    case "waiting":
      return "Ожидание";
    case "betting":
      return `СТАРТ ЧЕРЕЗ ${view.seconds}`;
    case "spinning":
      return "КРУТИМ";
    case "resolved":
      return "Раунд завершён";
  }
}
