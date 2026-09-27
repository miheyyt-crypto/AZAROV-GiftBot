import { useEffect, useState } from "react";
import { loadJson } from "../api.js";
import { openTelegramLink } from "../telegram.js";
import { Skeleton } from "../ui/Skeleton.js";
import { ContestReferralView } from "../contest/ContestReferralView.js";
import { parseContestPage } from "../contest/parse.js";
import type { ReferralContestPage } from "../contest/types.js";

function pollDelayMs(): number {
  return 7000 + Math.floor(Math.random() * 3000);
}

const EMPTY_PAGE: ReferralContestPage = {
  contest: null,
  leaderboard: [],
  me: null,
  serverNow: new Date().toISOString(),
};

export function ContestReferralPage({
  token,
  skipRemote = false,
  fixture,
}: {
  token: string;
  skipRemote?: boolean;
  fixture?: ReferralContestPage;
}) {
  const [page, setPage] = useState<ReferralContestPage>(fixture ?? EMPTY_PAGE);
  const [fetchedAtMs, setFetchedAtMs] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    skipRemote ? "ready" : "loading",
  );

  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    let timer: number | undefined;
    const arm = () => {
      if (document.visibilityState === "hidden") {
        if (timer !== undefined) {
          window.clearInterval(timer);
          timer = undefined;
        }
        return;
      }
      if (timer === undefined) {
        timer = window.setInterval(tick, 1000);
      }
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      if (timer !== undefined) {
        window.clearInterval(timer);
      }
      document.removeEventListener("visibilitychange", arm);
    };
  }, []);

  useEffect(() => {
    if (skipRemote) {
      setStatus("ready");
      return;
    }
    let cancelled = false;
    let timeout: number | undefined;
    const load = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      void loadJson(token, "/contest/referral", parseContestPage)
        .then((next) => {
          if (cancelled) {
            return;
          }
          setPage(next);
          setFetchedAtMs(Date.now());
          setStatus("ready");
        })
        .catch(() => {
          if (!cancelled) {
            setStatus((current) => (current === "ready" ? current : "error"));
          }
        });
    };
    load();
    const schedule = () => {
      if (timeout !== undefined) {
        window.clearTimeout(timeout);
      }
      if (document.visibilityState === "hidden") {
        return;
      }
      timeout = window.setTimeout(() => {
        load();
        schedule();
      }, pollDelayMs());
    };
    schedule();
    const onVis = () => {
      if (document.visibilityState === "visible") {
        load();
        schedule();
      } else if (timeout !== undefined) {
        window.clearTimeout(timeout);
        timeout = undefined;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      if (timeout !== undefined) {
        window.clearTimeout(timeout);
      }
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [token, skipRemote]);

  if (status === "loading") {
    return <Skeleton label="Загрузка конкурса" lines={8} />;
  }

  return (
    <ContestReferralView
      page={page}
      fetchedAtMs={fetchedAtMs}
      nowMs={nowMs}
      onInvite={() => {
        const url = page.me?.referralUrl;
        if (!url) {
          return;
        }
        openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}`);
      }}
    />
  );
}

export default ContestReferralPage;
