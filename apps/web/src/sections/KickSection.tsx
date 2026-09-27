import { useState } from "react";
import { startKickOAuth } from "../api.js";
import type { SectionPayload } from "../types.js";

export function KickSection({
  payload,
  token,
}: {
  payload: SectionPayload;
  token?: string;
}) {
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  if (payload.section !== "kick") {
    return (
      <section className="panel">
        <h2>Kick</h2>
        <p className="muted">This section is not available.</p>
      </section>
    );
  }

  async function linkKick(): Promise<void> {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const started = await startKickOAuth(token);
      window.location.assign(started.authorizationUrl);
    } catch {
      setError("Kick link could not be started.");
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Kick</h2>
      <p>{payload.kickLinked ? "Linked" : "Not linked"}</p>
      {!payload.kickLinked && token ? (
        <button type="button" className="retry" disabled={busy} onClick={() => void linkKick()}>
          Link Kick
        </button>
      ) : null}
      {error ? <p className="muted">{error}</p> : null}
      <p className="muted">Watch history is not loaded here.</p>
    </section>
  );
}

export default KickSection;
