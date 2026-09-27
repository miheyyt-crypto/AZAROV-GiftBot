import { EMPTY_STREAM_STREAK, type StreamStreakState } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function parseStreamStreak(value: unknown): StreamStreakState {
  const root = asRecord(value);
  if (!root) {
    throw new Error("invalid stream streak payload");
  }
  const currentStreak = readNumber(root.currentStreak);
  const freezeCount = readNumber(root.freezeCount);
  if (currentStreak === undefined || freezeCount === undefined) {
    throw new Error("invalid stream streak payload");
  }
  const completed = root.completed === true;
  const nextTarget =
    root.nextTarget === null ? null : readNumber(root.nextTarget) ?? null;
  const nextRewardAzc =
    root.nextRewardAzc === null
      ? null
      : readString(root.nextRewardAzc) ?? null;
  const streamRaw = asRecord(root.stream);
  if (!streamRaw) {
    throw new Error("invalid stream streak payload");
  }
  let stream: StreamStreakState["stream"];
  if (streamRaw.isLive === true) {
    const sessionId = readString(streamRaw.sessionId);
    const messages = readNumber(streamRaw.messages);
    const requiredMessages = readNumber(streamRaw.requiredMessages);
    if (
      !sessionId ||
      messages === undefined ||
      requiredMessages === undefined
    ) {
      throw new Error("invalid live stream streak payload");
    }
    stream = {
      isLive: true,
      sessionId,
      messages,
      requiredMessages,
      qualified: streamRaw.qualified === true,
    };
  } else {
    stream = { isLive: false };
  }
  return {
    currentStreak,
    completed,
    nextTarget,
    nextRewardAzc,
    freezeCount,
    stream,
  };
}

export function safeParseStreamStreak(value: unknown): StreamStreakState {
  try {
    return parseStreamStreak(value);
  } catch {
    return EMPTY_STREAM_STREAK;
  }
}
