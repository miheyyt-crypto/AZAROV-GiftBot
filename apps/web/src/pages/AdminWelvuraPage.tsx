import { useEffect, useState } from "react";
import {
  approveAdminWelvuraAccount,
  approveAdminWelvuraDeposit,
  loadAdminWelvuraAccounts,
  loadAdminWelvuraDeposits,
  loadAdminWelvuraFileBlob,
  rejectAdminWelvuraAccount,
  rejectAdminWelvuraDeposit,
} from "../api.js";
import { resolveAdminBearer } from "../admin/resolve-admin-bearer.js";
import { AdminLayout } from "../admin/AdminShell.js";
import { AdminStatusBadge } from "../admin/AdminStatusBadge.js";
import { SegmentedTabs } from "../components/SegmentedTabs.js";
import { createIdempotencyKey } from "../idempotency.js";
import { formatAzcAmount } from "../lib/format.js";
import type {
  AdminWelvuraAccountItem,
  AdminWelvuraDepositItem,
} from "../tasks/types.js";

type Section = "accounts" | "deposits";
type StatusFilter = "pending" | "approved" | "rejected" | "all";

const SECTION_TABS: { id: Section; label: string }[] = [
  { id: "accounts", label: "Аккаунты" },
  { id: "deposits", label: "Депозиты" },
];

const STATUS_TABS: { id: StatusFilter; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "all", label: "All" },
];

export function AdminWelvuraPage({
  skipRemote = false,
  isSuperAdmin = false,
}: {
  skipRemote?: boolean;
  isSuperAdmin?: boolean;
}) {
  const [adminToken, setAdminToken] = useState<string | undefined>();
  const [section, setSection] = useState<Section>("accounts");
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [accounts, setAccounts] = useState<AdminWelvuraAccountItem[]>([]);
  const [deposits, setDeposits] = useState<AdminWelvuraDepositItem[]>([]);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  useEffect(() => {
    if (skipRemote || !isSuperAdmin) {
      return;
    }
    let cancelled = false;
    void resolveAdminBearer()
      .then(async (token) => {
        if (cancelled) {
          return;
        }
        setAdminToken(token);
        if (section === "accounts") {
          const listed = await loadAdminWelvuraAccounts(token, status);
          if (!cancelled) {
            setAccounts(listed.items);
          }
        } else {
          const listed = await loadAdminWelvuraDeposits(token, status);
          if (!cancelled) {
            setDeposits(listed.items);
          }
        }
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        if (err instanceof Error && err.message === "telegram_required") {
          setError("Нужен Telegram, чтобы открыть админ-раздел.");
          return;
        }
        setError("Нет доступа");
      });
    return () => {
      cancelled = true;
    };
  }, [skipRemote, isSuperAdmin, section, status]);

  async function refresh(token: string): Promise<void> {
    if (section === "accounts") {
      const listed = await loadAdminWelvuraAccounts(token, status);
      setAccounts(listed.items);
    } else {
      const listed = await loadAdminWelvuraDeposits(token, status);
      setDeposits(listed.items);
    }
  }

  async function ensurePreview(fileId: string): Promise<void> {
    if (!adminToken || previews[fileId]) {
      return;
    }
    const url = await loadAdminWelvuraFileBlob(adminToken, fileId);
    setPreviews((prev) => ({ ...prev, [fileId]: url }));
  }

  async function run(
    action: () => Promise<unknown>,
    success: string,
  ): Promise<void> {
    if (!adminToken || submitting) {
      return;
    }
    setSubmitting(true);
    setNote(undefined);
    try {
      await action();
      setNote(success);
      setReason("");
      await refresh(adminToken);
    } catch {
      setNote("Ошибка модерации");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminLayout
      isSuperAdmin={isSuperAdmin}
      title="Welvura"
      description="Модерация аккаунтов и депозитов. Approve и reject без изменения наград."
      {...(error ? { error } : {})}
    >
      {note ? <p className="admin-note">{note}</p> : null}
      <SegmentedTabs value={section} options={SECTION_TABS} onChange={setSection} />
      <SegmentedTabs value={status} options={STATUS_TABS} onChange={setStatus} />
      <label>
        Причина reject
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {section === "accounts"
        ? accounts.map((item) => (
            <article key={item.id} className="admin-row admin-row--stack">
              <div className="admin-row__body">
                <p className="admin-row__title">{item.publicId}</p>
                <p className="admin-row__meta">@{item.username ?? "—"}</p>
                <p className="admin-row__meta">Welvura: {item.welvuraId}</p>
                <p className="admin-row__meta">
                  attempt {item.attemptNumber} · {item.submittedAt}
                </p>
              </div>
              <AdminStatusBadge status={item.status} />
              {item.rejectionReason ? (
                <p className="muted">Reject: {item.rejectionReason}</p>
              ) : null}
                <button
                  type="button"
                  className="admin-btn admin-btn--secondary"
                  onClick={() => void ensurePreview(item.screenshot.fileId)}
                >
                  Показать скриншот
                </button>
                {previews[item.screenshot.fileId] ? (
                  <img
                    className="admin-shot"
                    src={previews[item.screenshot.fileId]}
                    alt=""
                  />
                ) : null}
                {item.status === "pending" ? (
                  <div className="admin-row__actions">
                    <button
                      type="button"
                      className="admin-btn admin-btn--success"
                      disabled={submitting}
                      onClick={() =>
                        void run(
                          () =>
                            approveAdminWelvuraAccount(
                              adminToken!,
                              item.id,
                              createIdempotencyKey(),
                            ),
                          "Approved",
                        )
                      }
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--danger"
                      disabled={submitting || reason.trim().length === 0}
                      onClick={() =>
                        void run(
                          () =>
                            rejectAdminWelvuraAccount(
                              adminToken!,
                              item.id,
                              reason,
                              createIdempotencyKey(),
                            ),
                          "Rejected",
                        )
                      }
                    >
                      Reject
                    </button>
                  </div>
                ) : null}
            </article>
          ))
        : deposits.map((item) => (
            <article key={item.id} className="admin-row admin-row--stack">
              <div className="admin-row__body">
                <p className="admin-row__title">
                  Stage {item.stageNumber} · {item.publicId}
                </p>
                <p className="admin-row__meta">@{item.username ?? "—"}</p>
                <p className="admin-row__meta">Welvura: {item.welvuraId}</p>
                <p className="admin-row__meta">
                  от {item.requiredDepositRub} ₽ · {formatAzcAmount(item.rewardAzc)}
                </p>
                <p className="admin-row__meta">
                  Policy from {item.policyFrom} · attempt {item.attemptNumber} · {item.submittedAt}
                </p>
              </div>
              <AdminStatusBadge status={item.status} />
              {item.rejectionReason ? (
                <p className="muted">Reject: {item.rejectionReason}</p>
              ) : null}
                <button
                  type="button"
                  className="admin-btn admin-btn--secondary"
                  onClick={() => void ensurePreview(item.screenshot.fileId)}
                >
                  Показать скриншот
                </button>
                {previews[item.screenshot.fileId] ? (
                  <img
                    className="admin-shot"
                    src={previews[item.screenshot.fileId]}
                    alt=""
                  />
                ) : null}
                {item.status === "pending" ? (
                  <div className="admin-row__actions">
                    <button
                      type="button"
                      className="admin-btn admin-btn--success"
                      disabled={submitting}
                      onClick={() =>
                        void run(
                          () =>
                            approveAdminWelvuraDeposit(
                              adminToken!,
                              item.id,
                              createIdempotencyKey(),
                            ),
                          "Approved",
                        )
                      }
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--danger"
                      disabled={submitting || reason.trim().length === 0}
                      onClick={() =>
                        void run(
                          () =>
                            rejectAdminWelvuraDeposit(
                              adminToken!,
                              item.id,
                              reason,
                              createIdempotencyKey(),
                            ),
                          "Rejected",
                        )
                      }
                    >
                      Reject
                    </button>
                  </div>
                ) : null}
            </article>
          ))}
    </AdminLayout>
  );
}

export default AdminWelvuraPage;
