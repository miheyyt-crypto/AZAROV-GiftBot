/**
 * Shared Mini App round transition (there is no separate AndroidRoll / RollDesktop
 * tree — RollsPage drives both Telegram Android and desktop WebView).
 */
import type { RollsCurrent, RollsYou } from "./rolls-types.js";
import { shouldIgnoreStaleVersion } from "./rolls-spin.js";

/** How long the winner/result card stays after the local spin lands. */
export const ROLLS_RESULT_HOLD_MS = 3200;
export const ROLLS_NEXT_ROUND_RETRY_MS = [300, 700, 1500] as const;

export type RollsSnapshotApplyAction = "ignore" | "apply" | "defer" | "apply-reset";

export function shouldIgnoreStaleRollsSnapshot(input: {
  localRoundId: string | null;
  localVersion: string | null;
  incomingRoundId: string;
  incomingVersion: string;
}): boolean {
  if (!input.localRoundId || input.localRoundId !== input.incomingRoundId) {
    return false;
  }
  return shouldIgnoreStaleVersion(input.localVersion, input.incomingVersion);
}

/**
 * Same-round versions are comparable. A new roundId always wins over a
 * higher leftover version from the finished round (new waiting rounds start at 1).
 * While the local spin/result hold is open, the next round is deferred so the
 * wheel can finish and the winner card can show.
 */
export function decideRollsSnapshotApply(input: {
  localRoundId: string | null;
  localVersion: string | null;
  incomingRoundId: string;
  incomingVersion: string;
  fromWs: boolean;
  holdLocalRound: boolean;
}): RollsSnapshotApplyAction {
  if (
    input.fromWs &&
    shouldIgnoreStaleRollsSnapshot({
      localRoundId: input.localRoundId,
      localVersion: input.localVersion,
      incomingRoundId: input.incomingRoundId,
      incomingVersion: input.incomingVersion,
    })
  ) {
    return "ignore";
  }
  const roundChanged =
    Boolean(input.localRoundId) && input.localRoundId !== input.incomingRoundId;
  if (roundChanged && input.holdLocalRound) {
    return "defer";
  }
  if (roundChanged) {
    return "apply-reset";
  }
  return "apply";
}

export function mergeRollsYou(
  previous: RollsYou | null | undefined,
  incoming: RollsYou | null | undefined,
  roundChanged: boolean,
): RollsYou | null {
  if (roundChanged) {
    if (incoming) {
      return incoming;
    }
    if (previous?.userId) {
      return {
        userId: previous.userId,
        stakeAzc: "0",
        chancePercent: "0.00",
        participantId: null,
      };
    }
    return null;
  }
  return incoming ?? previous ?? null;
}

export function isPlayableRollsStatus(status: string): boolean {
  return status === "waiting" || status === "betting";
}

export async function loadNextRollsRound(input: {
  endedRoundId: string;
  load: () => Promise<RollsCurrent>;
  delaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}): Promise<RollsCurrent | null> {
  const delays = input.delaysMs ?? ROLLS_NEXT_ROUND_RETRY_MS;
  const sleep =
    input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let last: RollsCurrent | null = null;
  for (let i = 0; i <= delays.length; i += 1) {
    if (i > 0) {
      const wait = delays[i - 1];
      if (wait !== undefined) {
        await sleep(wait);
      }
    }
    try {
      last = await input.load();
    } catch {
      continue;
    }
    if (last.round.roundId !== input.endedRoundId) {
      return last;
    }
  }
  return last && last.round.roundId !== input.endedRoundId ? last : null;
}
