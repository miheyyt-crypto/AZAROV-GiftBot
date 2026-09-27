import { useEffect, useState } from "react";
import { loadAchievements } from "../api.js";
import { AchievementsView } from "../achievements/AchievementsView.js";
import type { AchievementListItem } from "../achievements/types.js";
import { BottomSheet } from "../components/BottomSheet.js";
import { navigate } from "../app/routes.js";

export function AchievementsPage({
  token,
  skipRemote = false,
}: {
  token: string;
  skipRemote?: boolean;
}) {
  const [items, setItems] = useState<AchievementListItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    skipRemote ? "ready" : "loading",
  );
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (skipRemote) {
      setStatus("ready");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    void loadAchievements(token)
      .then((listed) => {
        if (!cancelled) {
          setItems(listed.items);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, skipRemote, nonce]);

  return (
    <BottomSheet
      open
      title="Достижения"
      className="sheet--profile"
      onClose={() => navigate("#/profile")}
    >
      {status === "loading" ? (
        <p className="muted">Загрузка…</p>
      ) : status === "error" ? (
        <div className="stack">
          <p>Не удалось загрузить достижения.</p>
          <button type="button" onClick={() => setNonce((n) => n + 1)}>
            Повторить
          </button>
        </div>
      ) : (
        <AchievementsView items={items} />
      )}
    </BottomSheet>
  );
}

export default AchievementsPage;
