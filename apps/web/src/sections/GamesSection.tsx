import { useState } from "react";
import { playGame } from "../api.js";
import { keyForPost } from "../idempotency.js";
import type { SectionPayload } from "../types.js";

export function GamesSection({
  payload,
  token,
}: {
  payload: SectionPayload;
  token?: string;
}) {
  const [error, setError] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  if (payload.section !== "games") {
    return (
      <section className="panel">
        <h2>Play</h2>
        <p className="muted">This section is not available.</p>
      </section>
    );
  }

  async function play(
    gameId: string,
    settlementMode: string,
    betAmountMinor: string,
  ): Promise<void> {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      const played = await playGame(token, gameId, betAmountMinor, keyForPost(`POST /games/${gameId}/play`));
      setStatus(
        settlementMode === "async"
          ? `Round ${played.roundId} is ${played.status}.`
          : `Round ${played.roundId} settled.`,
      );
    } catch {
      setError("Play could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Play</h2>
      {payload.games.length === 0 ? (
        <p className="muted">No catalog games are configured.</p>
      ) : (
        payload.games.map((game) => (
          <div key={game.id}>
            <p>
              {game.title} ({game.settlementMode})
            </p>
            {game.allowedBetMinor.length === 0 ? (
              <p className="muted">Bet amounts are not configured.</p>
            ) : (
              game.allowedBetMinor.map((bet) => (
                <button
                  key={`${game.id}-${bet}`}
                  type="button"
                  className="retry"
                  disabled={busy || !token}
                  onClick={() => void play(game.id, game.settlementMode, bet)}
                >
                  Bet {bet}
                </button>
              ))
            )}
          </div>
        ))
      )}
      {status ? <p>{status}</p> : null}
      {error ? <p className="muted">{error}</p> : null}
      <p className="muted">Results are decided on the server. This client does not send a result.</p>
    </section>
  );
}

export default GamesSection;
