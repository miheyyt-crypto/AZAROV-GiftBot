import { useEffect, useState } from "react";
import { bootMiniApp, readDevRoleFromSearch, type DevLocalRole } from "./boot.js";
import { DevBadge } from "./components/DevBadge.js";
import { clearDevAdminToken, clearSession } from "./session.js";
import { pingMiniAppPresence } from "./api.js";
import { seedProfileFromBootstrap } from "./profile/profile-store.js";
import { applyServerBalance } from "./hooks/useAzcBalance.js";
import { Shell } from "./shell/Shell.js";
import { notifyTelegramReady, readTelegramInitData } from "./telegram.js";
import type { BootstrapPayload } from "./types.js";
import { Skeleton } from "./ui/Skeleton.js";

type Screen =
  | { kind: "booting" }
  | { kind: "needs_telegram" }
  | { kind: "error"; message: string; keepSession?: boolean }
  | {
      kind: "ready";
      bootstrap: BootstrapPayload;
      token: string;
      fixtureSectionError?: boolean;
      fixtureLocalSections?: boolean;
      devRole?: DevLocalRole;
    };

function fixtureBootstrap(): BootstrapPayload {
  return {
    user: {
      publicId: "00000000-0000-0000-0000-000000000001",
      displayName: "Fixture",
    },
    wallet: { balanceMinor: "0", currencyCode: "INTERNAL" },
    session: { expiresAt: "2099-01-01T00:00:00.000Z" },
    flags: { kickLinked: false, isSuperAdmin: false },
    counters: { referralsAttributed: 0 },
    referralCode: "fixture",
    configVersion: "0",
  };
}

function readDevFixture(): Screen | undefined {
  if (!import.meta.env.DEV) {
    return undefined;
  }
  const fixture = new URLSearchParams(window.location.search).get("fixture");
  if (fixture === "shell") {
    return {
      kind: "ready",
      bootstrap: fixtureBootstrap(),
      token: "fixture-token",
      fixtureLocalSections: true,
    };
  }
  if (fixture === "section-error") {
    return {
      kind: "ready",
      bootstrap: fixtureBootstrap(),
      token: "fixture-token",
      fixtureSectionError: true,
    };
  }
  return undefined;
}

function screenFromBoot(result: Awaited<ReturnType<typeof bootMiniApp>>): Screen {
  if (result.status === "ready") {
    seedProfileFromBootstrap(result.token, result.bootstrap);
    applyServerBalance(result.bootstrap.wallet.balanceMinor);
    return {
      kind: "ready",
      bootstrap: result.bootstrap,
      token: result.token,
      ...(result.devRole ? { devRole: result.devRole } : {}),
    };
  }
  if (result.status === "needs_telegram") {
    return { kind: "needs_telegram" };
  }
  return { kind: "error", message: result.message, ...(result.keepSession ? { keepSession: true } : {}) };
}

function MiniAppPresence({ token }: { token: string }) {
  useEffect(() => {
    if (token === "fixture-token") {
      return;
    }
    let stopped = false;
    const ping = () => {
      if (stopped || document.visibilityState === "hidden") {
        return;
      }
      void pingMiniAppPresence(token);
    };
    const firstDelay = 8_000 + Math.floor(Math.random() * 4_000);
    const first = window.setTimeout(ping, firstDelay);
    const timer = window.setInterval(ping, 60_000 + Math.floor(Math.random() * 5_000));
    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      window.setTimeout(ping, 300 + Math.floor(Math.random() * 1_200));
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [token]);
  return null;
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "booting" });

  useEffect(() => {
    notifyTelegramReady();
    const fixture = readDevFixture();
    if (fixture) {
      setScreen(fixture);
      return;
    }
    // StrictMode remounts once: ignore stale boot results. Combined with
    // bootMiniApp in-flight coalescing, session rotation runs once.
    let cancelled = false;
    const devRole = import.meta.env.DEV
      ? readDevRoleFromSearch(window.location.search)
      : undefined;
    void bootMiniApp(
      window.sessionStorage,
      readTelegramInitData,
      devRole ? { devRole } : {},
    ).then((result) => {
      if (cancelled) {
        return;
      }
      setScreen(screenFromBoot(result));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (screen.kind === "booting") {
    return <Skeleton label="Starting Mini App" lines={4} />;
  }
  if (screen.kind === "needs_telegram") {
    return (
      <section className="gate">
        <h1>GiftBot</h1>
        <p>Open this Mini App from Telegram.</p>
        {import.meta.env.DEV ? (
          <p className="gate-hint">
            Local browser QA: open{" "}
            <code>/?dev=user</code> or <code>/?dev=admin</code> with{" "}
            <code>pnpm dev:local</code> running.
          </p>
        ) : null}
      </section>
    );
  }
  if (screen.kind === "error") {
    return (
      <section className="gate">
        <h1>GiftBot</h1>
        <p>{screen.message}</p>
        <button
          type="button"
          className="retry"
          onClick={() => {
            const keepSession = screen.keepSession === true;
            if (!keepSession) {
              clearSession(window.sessionStorage);
              clearDevAdminToken(window.sessionStorage);
            }
            setScreen({ kind: "booting" });
            const devRole = import.meta.env.DEV
              ? readDevRoleFromSearch(window.location.search)
              : undefined;
            void bootMiniApp(
              window.sessionStorage,
              readTelegramInitData,
              devRole ? { devRole } : {},
            ).then((result) => {
              setScreen(screenFromBoot(result));
            });
          }}
        >
          Retry
        </button>
      </section>
    );
  }

  return (
    <>
      {screen.devRole ? <DevBadge role={screen.devRole} /> : null}
      <MiniAppPresence token={screen.token} />
      <Shell
        bootstrap={screen.bootstrap}
        token={screen.token}
        {...(screen.fixtureSectionError ? { fixtureSectionError: true } : {})}
        {...(screen.fixtureLocalSections ? { fixtureLocalSections: true } : {})}
      />
    </>
  );
}
