import { useEffect, useMemo, useState } from "react";
import {
  ApiRequestError,
  claimTask,
  loadJson,
  loadTasks,
  loadWelvura,
} from "../api.js";
import { navigate } from "../app/routes.js";
import { BottomSheet } from "../components/BottomSheet.js";
import { CoinAmount } from "../components/CoinAmount.js";
import { EmptyState } from "../components/EmptyState.js";
import { IdentityHeader } from "../components/IdentityHeader.js";
import { WelvuraBanner } from "../components/WelvuraBanner.js";
import { clearIdempotencyKey, keyForPost } from "../idempotency.js";
import { groupDigits } from "../lib/format.js";
import { loadSharedProfile } from "../profile/profile-store.js";
import { EMPTY_PROFILE_SUMMARY, type ProfileSummary } from "../profile/types.js";
import {
  applyServerBalance,
  refreshBalanceIfAmbiguous,
  useAzcBalance,
} from "../hooks/useAzcBalance.js";
import { openTelegramLink } from "../telegram.js";
import { WelvuraChainView } from "../tasks/WelvuraChainView.js";
import type { TaskCategory, TaskListItem, WelvuraState } from "../tasks/types.js";
import { readWelvuraPreview } from "../tasks/welvura-preview.js";

const TABS: { id: TaskCategory | "all"; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "kick", label: "Kick" },
  { id: "tg", label: "TG" },
  { id: "social", label: "Соцсети" },
  { id: "partners", label: "Партнёры" },
];

function taskIconKind(task: TaskListItem): string {
  if (task.code.includes("nickname")) {
    return "tag";
  }
  if (task.code === "kick_link") {
    return "link";
  }
  if (task.code.includes("follow")) {
    return "heart";
  }
  if (task.code.includes("subscribe") || task.category === "tg") {
    return "tg";
  }
  if (task.code.includes("bot")) {
    return "bot";
  }
  if (task.code.includes("referral") || task.category === "social") {
    return "users";
  }
  return task.category;
}

export function TaskGlyph({ kind }: { kind: string }) {
  if (kind === "tag") {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
        <path
          d="M4 12V6.8A1.8 1.8 0 0 1 5.8 5H12l8 8-6.2 6.2L4 12Z"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <circle cx="9" cy="9" r="1.2" fill="currentColor" />
      </svg>
    );
  }
  if (kind === "link") {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
        <path
          d="M10 14a4 4 0 0 0 6 0l2.5-2.5a4 4 0 1 0-5.6-5.6L12 7"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <path
          d="M14 10a4 4 0 0 0-6 0L5.5 12.5a4 4 0 1 0 5.6 5.6L12 17"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (kind === "heart") {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
        <path
          d="M12 20s-7-4.4-7-9.2A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.8C19 15.6 12 20 12 20Z"
          stroke="currentColor"
          strokeWidth="1.7"
        />
      </svg>
    );
  }
  if (kind === "tg" || kind === "bot") {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
        <path
          d="M20.5 4.5 3.8 11.2c-.8.3-.8 1.5.1 1.8l4.2 1.3 1.6 4.8c.3.8 1.3.9 1.8.2l2.3-3.2 4.4 3.2c.7.5 1.7.1 1.9-.7L21.6 5.6c.2-.9-.7-1.6-1.5-1.1Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="16" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M4.2 19a4.8 4.8 0 0 1 9.6 0M13.2 19a4.2 4.2 0 0 1 6.6-3.4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function openExternal(url: string): void {
  if (url.startsWith("https://t.me/") || url.startsWith("tg://")) {
    openTelegramLink(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}

function statusLabel(task: TaskListItem): string {
  if (task.state === "completed") {
    return "✓ Выполнено";
  }
  if (task.state === "verification_unavailable") {
    return "Временно недоступно";
  }
  return "Не выполнено";
}

function sheetCtaLabel(task: TaskListItem): string {
  if (task.state === "verification_unavailable") {
    return "Временно недоступно";
  }
  if (task.code === "kick_link" && task.state === "requirement_not_met") {
    return "Привязать";
  }
  if (task.code === "referral_3_active") {
    return "К друзьям";
  }
  return "Проверить";
}

export function TasksPage({
  token,
  skipRemote = false,
}: {
  token: string;
  skipRemote?: boolean;
}) {
  const [tab, setTab] = useState<TaskCategory | "all">("all");
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [welvura, setWelvura] = useState<WelvuraState | null>(null);
  const [profile, setProfile] = useState<ProfileSummary>(EMPTY_PROFILE_SUMMARY);
  const balanceAzc = useAzcBalance(token, skipRemote);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    skipRemote ? "ready" : "loading",
  );
  const [note, setNote] = useState<string | undefined>();
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [welvuraOpen, setWelvuraOpen] = useState(false);
  const [openCode, setOpenCode] = useState<string | null>(null);

  useEffect(() => {
    if (skipRemote) {
      setStatus("ready");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    void Promise.all([
      loadTasks(token),
      loadWelvura(token),
      loadSharedProfile(token),
    ])
      .then(([listed, state, summary]) => {
        if (cancelled) {
          return;
        }
        setTasks(listed.tasks);
        setWelvura(state);
        setProfile(summary);
        applyServerBalance(summary.balances.azc);
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
  }, [token, skipRemote, nonce]);

  useEffect(() => {
    if (window.location.hash.includes("welvura")) {
      setWelvuraOpen(true);
      return;
    }
    if (readWelvuraPreview(window.location.search, {
      nodeEnv: import.meta.env.PROD ? "production" : (import.meta.env.MODE ?? "development"),
      allowDevAuth: import.meta.env.DEV === true,
    })) {
      setWelvuraOpen(true);
    }
  }, []);

  const visible = useMemo(() => {
    if (tab === "all") {
      return tasks;
    }
    return tasks.filter((task) => task.category === tab);
  }, [tasks, tab]);

  const selected = tasks.find((task) => task.code === openCode) ?? null;
  const showPartners = tab === "all" || tab === "partners";

  async function runClaim(task: TaskListItem): Promise<void> {
    if (busyCode || task.state === "verification_unavailable") {
      return;
    }
    const route = `POST /tasks/${task.code}/claim`;
    setBusyCode(task.code);
    setNote(undefined);
    try {
      const key = keyForPost(route);
      const result = await claimTask(token, task.code, key);
      clearIdempotencyKey(route);
      applyServerBalance(result.balances.azc);
      setNote(
        result.replayed ? "Уже выполнено" : `+${groupDigits(result.rewardAzc)}`,
      );
      setNonce((n) => n + 1);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setNote(error.code ?? "Ошибка проверки");
      } else {
        setNote("Ошибка");
      }
      await refreshBalanceIfAmbiguous(token, error);
    } finally {
      setBusyCode(null);
    }
  }

  function primaryAction(task: TaskListItem): void {
    if (task.state === "completed" || task.state === "verification_unavailable") {
      return;
    }
    switch (task.actionHint ?? task.code) {
      case "kick_link":
        if (task.state === "requirement_not_met") {
          navigate("#/profile");
          return;
        }
        void runClaim(task);
        return;
      case "kick_follow":
        openExternal("https://kick.com/azarov7777");
        void runClaim(task);
        return;
      case "kick_nickname":
        openExternal("https://kick.com/azarov7777");
        void runClaim(task);
        return;
      case "telegram_channel":
        openExternal("https://t.me/azarov222");
        void runClaim(task);
        return;
      case "telegram_bot":
        openExternal("https://t.me/AZAROV_GiftBot");
        void runClaim(task);
        return;
      case "friends":
        navigate("#/friends");
        if (task.state === "available") {
          void runClaim(task);
        }
        return;
      default:
        void runClaim(task);
    }
  }

  return (
    <div className="stack tasks-page">
      <IdentityHeader summary={profile} balanceAzc={balanceAzc} />

      <div className="task-chips h-scroll" role="tablist">
        {TABS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={tab === option.id}
            className={tab === option.id ? "task-chip is-active" : "task-chip"}
            onClick={() => setTab(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <WelvuraBanner state={welvura} onOpen={() => setWelvuraOpen(true)} />

      {showPartners ? (
        <div className="tasks-partners-label">
          <span>Партнёры</span>
          <span className="muted">самые крупные награды</span>
        </div>
      ) : null}

      <div className="tasks-welvura-rule" aria-hidden="true" />

      {note ? <p className="muted motion-state">{note}</p> : null}
      {status === "loading" ? <p className="muted motion-state">Загрузка…</p> : null}
      {status === "error" ? <p className="motion-state">Не удалось загрузить задания</p> : null}

      {status === "ready" && visible.length === 0 && tab !== "partners" ? (
        <EmptyState title="Пусто" text="Заданий в этой вкладке пока нет." />
      ) : null}

      {visible.map((task) => {
        const kind = taskIconKind(task);
        return (
          <button
            key={task.code}
            type="button"
            className={`task-card task-card--${task.state} task-card--${task.category}`}
            onClick={() => setOpenCode(task.code)}
          >
            <div
              className={`task-card__icon task-card__icon--${kind}${
                task.category === "tg" ? " is-tg" : ""
              }`}
              aria-hidden="true"
            >
              <TaskGlyph kind={kind} />
            </div>
            <div className="task-card__body">
              <div className="task-card__top">
                <p className="task-card__title">{task.title}</p>
                <span className="task-card__reward">
                  <CoinAmount amount={task.rewardAzc} size={13} />
                </span>
              </div>
              <p className="task-card__desc">{task.description}</p>
              <p
                className={
                  task.state === "completed"
                    ? "task-card__status is-done"
                    : task.state === "verification_unavailable"
                      ? "task-card__status is-unavailable"
                      : "task-card__status"
                }
              >
                {statusLabel(task)}
              </p>
            </div>
          </button>
        );
      })}

      <BottomSheet
        open={Boolean(selected)}
        title={selected?.title ?? "Задание"}
        onClose={() => setOpenCode(null)}
        className="sheet--task-detail"
      >
        {selected ? (
          <div className="task-detail">
            <div className="task-detail__reward-row">
              <div
                className={`task-card__icon task-card__icon--lg task-card__icon--${taskIconKind(selected)}${
                  selected.category === "tg" ? " is-tg" : ""
                }`}
                aria-hidden="true"
              >
                <TaskGlyph kind={taskIconKind(selected)} />
              </div>
              <p className="task-detail__reward">
                <CoinAmount amount={selected.rewardAzc} size={22} />
              </p>
            </div>
            <p className="task-detail__copy">{selected.description}</p>
            {selected.state === "completed" ? (
              <p className="task-card__status is-done">✓ Выполнено</p>
            ) : null}
            {note && openCode === selected.code ? (
              <p className={note.startsWith("+") || note === "Уже выполнено" ? "ok" : "error"}>
                {note}
              </p>
            ) : null}
            {selected.state !== "completed" ? (
              <button
                type="button"
                className="primary task-detail__cta"
                disabled={
                  busyCode === selected.code ||
                  selected.state === "verification_unavailable"
                }
                onClick={() => primaryAction(selected)}
              >
                {busyCode === selected.code ? "…" : sheetCtaLabel(selected)}
              </button>
            ) : null}
          </div>
        ) : null}
      </BottomSheet>

      <BottomSheet
        open={welvuraOpen}
        title="Welvura"
        onClose={() => {
          setWelvuraOpen(false);
          if (window.location.hash.includes("welvura")) {
            navigate("#/tasks");
          }
        }}
        className="sheet--welvura"
      >
        <WelvuraChainView
          token={token}
          skipRemote={skipRemote}
          initialState={welvura}
        />
      </BottomSheet>
    </div>
  );
}

export default TasksPage;
