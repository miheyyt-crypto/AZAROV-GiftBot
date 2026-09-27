import { useEffect, useState } from "react";
import {
  ApiRequestError,
  joinGiveawayApi,
  loadGiveaways,
  startKickOAuth,
} from "../api.js";
import { Skeleton } from "../ui/Skeleton.js";
import { clearIdempotencyKey, keyForPost } from "../idempotency.js";
import { GiveawayEmpty } from "../giveaways/GiveawayEmpty.js";
import { GiveawayTabs } from "../giveaways/GiveawayTabs.js";
import { GiveawaysView } from "../giveaways/GiveawaysView.js";
import { friendlyGiveawayError } from "../giveaways/messages.js";
import type { GiveawayPublic, GiveawayTab } from "../giveaways/types.js";
import { PageHeader } from "../components/PageHeader.js";

export function GiveawaysPage({
  token,
  skipRemote = false,
  viewerPublicId,
  fixtureTab,
  fixtureItems,
  fixtureStatus,
}: {
  token: string;
  skipRemote?: boolean;
  viewerPublicId?: string;
  fixtureTab?: GiveawayTab;
  fixtureItems?: GiveawayPublic[];
  fixtureStatus?: "loading" | "ready" | "error";
}) {
  const [tab, setTab] = useState<GiveawayTab>(fixtureTab ?? "active");
  const [items, setItems] = useState<GiveawayPublic[]>(fixtureItems ?? []);
  const [serverTime, setServerTime] = useState(() => new Date().toISOString());
  const [fetchedAtMs, setFetchedAtMs] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    skipRemote ? (fixtureStatus ?? "ready") : "loading",
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | undefined>();
  const [nonce, setNonce] = useState(0);

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
    const onVis = () => arm();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (timer !== undefined) {
        window.clearInterval(timer);
      }
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    if (skipRemote) {
      setStatus(fixtureStatus ?? "ready");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    void loadGiveaways(token, tab)
      .then((listed) => {
        if (cancelled) {
          return;
        }
        setItems(listed.items);
        setServerTime(listed.serverTime);
        setFetchedAtMs(Date.now());
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, skipRemote, tab, nonce, fixtureStatus]);

  async function onJoin(id: string): Promise<void> {
    if (busyId || skipRemote) {
      return;
    }
    const route = `POST /giveaways/${id}/join`;
    setBusyId(id);
    setNote(undefined);
    try {
      await joinGiveawayApi(token, id, keyForPost(route));
      clearIdempotencyKey(route);
      setItems((current) =>
        current.map((row) =>
          row.id === id
            ? {
                ...row,
                joined: true,
                participantCount: row.joined
                  ? row.participantCount
                  : row.participantCount + 1,
              }
            : row,
        ),
      );
      setNote("Вы участвуете");
    } catch (error) {
      if (error instanceof ApiRequestError && error.status < 500) {
        clearIdempotencyKey(route);
      }
      setNote(
        friendlyGiveawayError(
          error instanceof ApiRequestError ? error.code : undefined,
        ),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function onLinkKick(): Promise<void> {
    if (skipRemote) {
      return;
    }
    setNote(undefined);
    try {
      const started = await startKickOAuth(token);
      window.location.assign(started.authorizationUrl);
    } catch {
      setNote("Не удалось начать привязку Kick");
    }
  }

  return (
    <div className="stack giveaways-page">
      <div className="giveaways-atmosphere" aria-hidden="true" />
      <PageHeader title="Розыгрыши" backHref="#/" align="start" />
      <GiveawayTabs value={tab} onChange={setTab} />
      {status === "loading" ? (
        <Skeleton label="Загрузка розыгрышей" lines={3} />
      ) : status === "error" ? (
        <GiveawayEmpty
          kind="error"
          action={
            <button
              type="button"
              className="giveaway-empty__action"
              onClick={() => setNonce((n) => n + 1)}
            >
              Повторить
            </button>
          }
        />
      ) : (
        <GiveawaysView
          tab={tab}
          items={items}
          serverTime={serverTime}
          fetchedAtMs={fetchedAtMs}
          nowMs={nowMs}
          {...(viewerPublicId ? { viewerPublicId } : {})}
          busyId={busyId}
          {...(note ? { note } : {})}
          onJoin={(id) => {
            void onJoin(id);
          }}
          onLinkKick={() => {
            void onLinkKick();
          }}
          onShowCompleted={() => setTab("completed")}
        />
      )}
    </div>
  );
}

export default GiveawaysPage;
