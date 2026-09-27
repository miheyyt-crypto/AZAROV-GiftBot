export type RollsWsCursor = {
  roundId?: string;
  roundVersion?: string;
};

/**
 * Versions are per-round. A new waiting round starts at a low version and must
 * still be pushed to sockets that last saw a spinning round with a higher version.
 */
export function shouldSkipRollsWsSnapshot(
  socket: RollsWsCursor,
  snapshot: { roundId: string; version: string },
): boolean {
  if (socket.roundId && socket.roundId !== snapshot.roundId) {
    return false;
  }
  if (!socket.roundVersion) {
    return false;
  }
  try {
    return BigInt(snapshot.version) < BigInt(socket.roundVersion);
  } catch {
    return false;
  }
}
