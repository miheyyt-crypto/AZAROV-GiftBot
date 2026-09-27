import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiRequestError,
  loadWelvura,
  submitWelvuraAccount,
  submitWelvuraStage,
} from "../api.js";
import { CoinAmount } from "../components/CoinAmount.js";
import { CookieArt } from "../components/WelvuraBanner.js";
import { formatRubAmount } from "../lib/format.js";
import { clearIdempotencyKey, keyForPost } from "../idempotency.js";
import type { WelvuraState } from "../tasks/types.js";
import {
  splitWelvuraInstruction,
  welvuraLockedStatus,
} from "./welvura-copy.js";
import {
  applyWelvuraPreview,
  defaultWelvuraPreviewEnv,
  readWelvuraPreview,
  type WelvuraPreviewEnv,
} from "./welvura-preview.js";

async function fileToBase64(file: File): Promise<{
  contentType: string;
  screenshotBase64: string;
  originalFilename: string;
}> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return {
    contentType: file.type || "image/png",
    screenshotBase64: btoa(binary),
    originalFilename: file.name,
  };
}

function WelvuraMark() {
  return (
    <div className="welvura-mark" aria-hidden="true">
      <CookieArt compact />
    </div>
  );
}

function LockIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
      <rect x="6" y="11" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8.5 11V8.5a3.5 3.5 0 0 1 7 0V11" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 8v5l3 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M5.5 18.5c.8-3.2 3.2-5 6.5-5s5.7 1.8 6.5 5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <rect x="4" y="6" width="16" height="13" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="9" cy="11" r="1.4" fill="currentColor" />
      <path d="M7 17.5 11 13l3 3 2.2-2.2L19 17.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function WelvuraChainView({
  token,
  skipRemote = false,
  initialState = null,
  previewSearch,
  previewEnv,
}: {
  token: string;
  skipRemote?: boolean;
  initialState?: WelvuraState | null;
  previewSearch?: string;
  previewEnv?: WelvuraPreviewEnv;
}) {
  const [state, setState] = useState<WelvuraState | null>(initialState);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    skipRemote || initialState ? "ready" : "loading",
  );
  const [welvuraId, setWelvuraId] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [stageFile, setStageFile] = useState<File | null>(null);
  const [stagePreview, setStagePreview] = useState<string | null>(null);
  const [note, setNote] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [nonce, setNonce] = useState(0);
  const submitLock = useRef(false);

  const search =
    previewSearch ??
    (typeof window !== "undefined" ? window.location.search : "");
  const env =
    previewEnv ??
    (typeof import.meta !== "undefined" &&
    import.meta.env &&
    typeof import.meta.env.DEV === "boolean"
      ? {
          nodeEnv: import.meta.env.PROD ? "production" : (import.meta.env.MODE ?? "development"),
          allowDevAuth: import.meta.env.DEV === true,
        }
      : defaultWelvuraPreviewEnv());
  const previewMode = readWelvuraPreview(search, env);
  const viewState = useMemo(() => {
    if (!state) {
      return null;
    }
    return previewMode ? applyWelvuraPreview(state, previewMode) : state;
  }, [state, previewMode]);

  useEffect(() => {
    if (skipRemote) {
      setStatus("ready");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    void loadWelvura(token)
      .then((next) => {
        if (!cancelled) {
          setState(next);
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

  async function onAccountSubmit(): Promise<void> {
    if (submitLock.current || submitting || !file) {
      return;
    }
    submitLock.current = true;
    setSubmitting(true);
    setNote(undefined);
    const route = "POST /welvura/account/submissions";
    try {
      const payload = await fileToBase64(file);
      const key = keyForPost(route);
      await submitWelvuraAccount(
        token,
        {
          welvuraId: welvuraId.trim(),
          contentType: payload.contentType,
          screenshotBase64: payload.screenshotBase64,
          originalFilename: payload.originalFilename,
        },
        key,
      );
      clearIdempotencyKey(route);
      setNote("Заявка отправлена");
      setFile(null);
      setPreview(null);
      setNonce((n) => n + 1);
    } catch (error) {
      setNote(
        error instanceof ApiRequestError
          ? error.code ?? "Ошибка"
          : "Ошибка отправки",
      );
    } finally {
      setSubmitting(false);
      submitLock.current = false;
    }
  }

  async function onStageSubmit(stageNumber: number): Promise<void> {
    if (submitLock.current || submitting || !stageFile) {
      return;
    }
    submitLock.current = true;
    setSubmitting(true);
    setNote(undefined);
    const route = `POST /welvura/stages/${stageNumber}/submissions`;
    try {
      const payload = await fileToBase64(stageFile);
      const key = keyForPost(route);
      await submitWelvuraStage(
        token,
        stageNumber,
        {
          contentType: payload.contentType,
          screenshotBase64: payload.screenshotBase64,
          originalFilename: payload.originalFilename,
        },
        key,
      );
      clearIdempotencyKey(route);
      setNote("Скриншот отправлен на проверку");
      setStageFile(null);
      setStagePreview(null);
      setNonce((n) => n + 1);
    } catch (error) {
      setNote(
        error instanceof ApiRequestError
          ? error.code ?? "Ошибка"
          : "Ошибка отправки",
      );
    } finally {
      setSubmitting(false);
      submitLock.current = false;
    }
  }

  const accountApproved = viewState?.account.state === "approved";
  const done =
    (viewState?.progress.completedStages ?? 0) + (accountApproved ? 1 : 0);
  const total = (viewState?.progress.totalStages ?? 13) + 1;
  const progressPct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const accountEditable =
    viewState?.account.state === "not_submitted" ||
    viewState?.account.state === "rejected";

  return (
    <div className="stack welvura-chain">
      {status === "loading" ? <p className="muted">Загрузка…</p> : null}
      {status === "error" ? <p>Не удалось загрузить Welvura</p> : null}
      {note ? <p className="muted">{note}</p> : null}

      <section className="welvura-intro">
        <div className="welvura-intro__icon">
          <WelvuraMark />
        </div>
        <p className="welvura-intro__copy">
          <strong>
            Сначала привяжи аккаунт — после этого депозитные задания открываются
            по очереди.
          </strong>
          <span>
            Следующее становится доступным только после выполнения предыдущего.
          </span>
        </p>
      </section>

      {viewState ? (
        <div className="welvura-progress">
          <div className="welvura-progress__row">
            <span>Выполнено</span>
            <strong>
              {done} из {total}
            </strong>
          </div>
          <div
            className="welvura-progress__track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
          >
            <span style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      ) : null}

      {viewState && viewState.account.state !== "approved" ? (
        <section
          className={[
            "welvura-stage",
            "welvura-stage--active",
            viewState.account.state === "pending" ? "welvura-stage--pending" : "",
            viewState.account.state === "rejected" ? "welvura-stage--rejected" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div className="welvura-stage__head">
            <span className="welvura-stage__num">1</span>
            <div className="welvura-stage__heading">
              <p className="welvura-stage__title">Привязать аккаунт Welvura</p>
            </div>
            {viewState.account.state === "pending" ? (
              <span className="welvura-pill is-pending">
                <ClockIcon /> На проверке
              </span>
            ) : null}
            {viewState.account.state === "rejected" ? (
              <span className="welvura-pill is-rejected">Отклонено</span>
            ) : null}
          </div>
          {viewState.account.state === "rejected" ? (
            <p className="welvura-stage__status is-rejected">
              {viewState.account.rejectionReason ?? "—"}
            </p>
          ) : null}
          <div className="welvura-stage__foot">
            <p className="welvura-stage__reward">
              <CoinAmount amount={viewState.account.rewardAzc} />
            </p>
          </div>
          {accountEditable ? (
            <div className="stack welvura-form">
              <label className="welvura-field">
                <UserIcon />
                <input
                  value={welvuraId}
                  onChange={(e) => setWelvuraId(e.target.value)}
                  autoComplete="off"
                  placeholder="Введите Welvura ID"
                />
              </label>
              <label className="welvura-field welvura-field--file" data-interactive="true">
                <ImageIcon />
                <span>{file ? file.name : "Загрузить скриншот"}</span>
                <ChevronIcon />
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(e) => {
                    const next = e.target.files?.[0] ?? null;
                    setFile(next);
                    setPreview(next ? URL.createObjectURL(next) : null);
                  }}
                />
              </label>
              {preview ? (
                <img className="welvura-preview" src={preview} alt="preview" />
              ) : null}
              <button
                type="button"
                className="primary welvura-submit"
                disabled={submitting || !file || welvuraId.trim().length === 0}
                onClick={() => void onAccountSubmit()}
              >
                {submitting ? "Отправка…" : "Отправить на проверку"}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {viewState?.account.state === "approved" ? (
        <>
          <section className="welvura-stage welvura-stage--done">
            <div className="welvura-stage__head">
              <span className="welvura-stage__num is-done">✓</span>
              <div className="welvura-stage__heading">
                <p className="welvura-stage__title">Привязать аккаунт Welvura</p>
                <p className="welvura-stage__lead">
                  ID: {viewState.account.welvuraId ?? "—"}
                </p>
              </div>
              <span className="welvura-pill is-done">✓ Выполнено</span>
            </div>
            <div className="welvura-stage__foot">
              <p className="welvura-stage__reward">
                <CoinAmount amount={viewState.account.rewardAzc} />
              </p>
            </div>
          </section>
          <p className="welvura-policy">
            Засчитываются депозиты с 11 сентября 2026. Один депозит закрывает
            одно задание.
          </p>
          {viewState.stages.map((stage) => (
            <DepositStageCard
              key={stage.stageNumber}
              stage={stage}
              accountApproved
              welvuraId={viewState.account.welvuraId}
              stageFile={stageFile}
              stagePreview={stagePreview}
              submitting={submitting}
              onFile={(next) => {
                setStageFile(next);
                setStagePreview(next ? URL.createObjectURL(next) : null);
              }}
              onSubmit={() => void onStageSubmit(stage.stageNumber)}
            />
          ))}
        </>
      ) : viewState ? (
        viewState.stages.map((stage) => (
          <DepositStageCard
            key={stage.stageNumber}
            stage={stage}
            accountApproved={false}
            welvuraId={null}
            stageFile={null}
            stagePreview={null}
            submitting={false}
            onFile={() => undefined}
            onSubmit={() => undefined}
          />
        ))
      ) : null}
    </div>
  );
}

function DepositStageCard({
  stage,
  accountApproved,
  welvuraId,
  stageFile,
  stagePreview,
  submitting,
  onFile,
  onSubmit,
}: {
  stage: WelvuraState["stages"][number];
  accountApproved: boolean;
  welvuraId: string | null;
  stageFile: File | null;
  stagePreview: string | null;
  submitting: boolean;
  onFile: (file: File | null) => void;
  onSubmit: () => void;
}) {
  const locked = stage.state === "locked" || !accountApproved;
  const active =
    accountApproved && (stage.state === "available" || stage.state === "rejected");
  const copy = splitWelvuraInstruction(stage.instruction);
  const status =
    !accountApproved || stage.state === "locked"
      ? welvuraLockedStatus(accountApproved)
      : stage.state === "pending"
        ? "На проверке"
        : stage.state === "approved"
          ? "✓ Выполнено"
          : stage.state === "rejected"
            ? `Отклонено: ${stage.rejectionReason ?? ""}`
            : "Доступно";

  return (
    <article
      className={[
        "welvura-stage",
        locked ? "welvura-stage--locked" : "",
        active ? "welvura-stage--active" : "",
        stage.state === "approved" && accountApproved ? "welvura-stage--done" : "",
        stage.state === "pending" && accountApproved ? "welvura-stage--pending" : "",
        stage.state === "rejected" && accountApproved ? "welvura-stage--rejected" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="welvura-stage__head">
        <span className="welvura-stage__num">
          {locked ? <LockIcon /> : stage.stageNumber + 1}
        </span>
        <div className="welvura-stage__heading">
          <p className="welvura-stage__title">
            Депозит {formatRubAmount(stage.requiredDepositRub)} в{"\u00a0"}Welvura
          </p>
        </div>
        {stage.state === "pending" && accountApproved ? (
          <span className="welvura-pill is-pending">
            <ClockIcon /> На проверке
          </span>
        ) : null}
        {stage.state === "approved" && accountApproved ? (
          <span className="welvura-pill is-done">✓ Выполнено</span>
        ) : null}
      </div>
      <p className="welvura-stage__lead">{copy.lead}</p>
      {copy.meta ? <p className="welvura-stage__meta">{copy.meta}</p> : null}
      <div className="welvura-stage__foot">
        <p className="welvura-stage__reward">
          <CoinAmount amount={stage.rewardAzc} />
        </p>
        {locked || (stage.state === "rejected" && accountApproved) ? (
          <p
            className={[
              "welvura-stage__status",
              stage.state === "rejected" && accountApproved ? "is-rejected" : "",
              locked ? "is-locked" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {locked ? <LockIcon size={13} /> : null}
            {status}
          </p>
        ) : null}
      </div>
      {accountApproved && (stage.state === "available" || stage.state === "rejected") ? (
        <div className="stack welvura-form">
          {welvuraId ? <p className="welvura-stage__meta">ID: {welvuraId}</p> : null}
          <label className="welvura-field welvura-field--file" data-interactive="true">
            <ImageIcon />
            <span>{stageFile ? stageFile.name : "Загрузить скриншот"}</span>
            <ChevronIcon />
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {stagePreview ? (
            <img className="welvura-preview" src={stagePreview} alt="stage preview" />
          ) : null}
          <button
            type="button"
            className="primary welvura-submit"
            disabled={submitting || !stageFile}
            onClick={onSubmit}
          >
            {submitting ? "Отправка…" : "Отправить на проверку"}
          </button>
        </div>
      ) : null}
    </article>
  );
}
