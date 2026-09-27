import { useEffect, useState } from "react";
import {
  fulfillAdminCashWithdrawal,
  loadAdminCashWithdrawals,
  processAdminCashWithdrawal,
  rejectAdminCashWithdrawal,
  type AdminCashWithdrawalItem,
} from "../api.js";
import { AdminCashWithdrawalsView } from "../admin/AdminCashWithdrawalsView.js";
import { AdminLayout } from "../admin/AdminShell.js";
import { resolveAdminBearer } from "../admin/resolve-admin-bearer.js";
import { createIdempotencyKey } from "../idempotency.js";
import type { CashItemWithdrawalStatus } from "../profile/types.js";

export function AdminCashWithdrawalsPage({
  skipRemote = false,
  isSuperAdmin = false,
}: {
  skipRemote?: boolean;
  isSuperAdmin?: boolean;
}) {
  const [adminToken, setAdminToken] = useState<string | undefined>();
  const [items, setItems] = useState<AdminCashWithdrawalItem[]>([]);
  const [status, setStatus] = useState<CashItemWithdrawalStatus | "all">("all");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (skipRemote || !isSuperAdmin) {
      return;
    }
    let cancelled = false;
    void resolveAdminBearer()
      .then(async (token) => {
        const listed = await loadAdminCashWithdrawals(token, status);
        if (!cancelled) {
          setAdminToken(token);
          setItems(listed.items);
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
  }, [skipRemote, isSuperAdmin, status]);

  async function refresh(token: string, nextStatus = status): Promise<void> {
    const listed = await loadAdminCashWithdrawals(token, nextStatus);
    setItems(listed.items);
  }

  async function runAction(
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
      await refresh(adminToken);
    } catch {
      setNote("Не удалось обновить заявку");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminLayout
      isSuperAdmin={isSuperAdmin}
      title="Выводы ₽"
      description="Заявки на вывод рублей. Fulfil и reject без изменения семантики."
      {...(error ? { error } : {})}
    >
      <AdminCashWithdrawalsView
        items={items}
        status={status}
        reason={reason}
        {...(note ? { note } : {})}
        submitting={submitting || skipRemote}
        onStatusChange={(next) => {
          setStatus(next);
        }}
        onReasonChange={setReason}
        onProcess={(id) => {
          void runAction(
            () => processAdminCashWithdrawal(adminToken ?? "", id, createIdempotencyKey()),
            "Заявка в обработке",
          );
        }}
        onFulfill={(id) => {
          void runAction(
            () => fulfillAdminCashWithdrawal(adminToken ?? "", id, createIdempotencyKey()),
            "Приз отмечен как выданный",
          );
        }}
        onReject={(id) => {
          if (!reason.trim()) {
            setNote("Укажите причину отклонения");
            return;
          }
          void runAction(
            () =>
              rejectAdminCashWithdrawal(
                adminToken ?? "",
                id,
                reason.trim(),
                createIdempotencyKey(),
              ),
            "Заявка отклонена",
          );
        }}
      />
    </AdminLayout>
  );
}

export default AdminCashWithdrawalsPage;
