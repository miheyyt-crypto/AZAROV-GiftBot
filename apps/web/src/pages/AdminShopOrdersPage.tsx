import { useEffect, useState } from "react";
import {
  approveAdminStreamGif,
  fulfillAdminShopOrder,
  loadAdminShopOrders,
  processAdminShopOrder,
  rejectAdminShopOrder,
  type AdminShopOrderItem,
} from "../api.js";
import { resolveAdminBearer } from "../admin/resolve-admin-bearer.js";
import { AdminLayout } from "../admin/AdminShell.js";
import { createIdempotencyKey, keyForPost } from "../idempotency.js";
import { AdminShopOrdersView } from "../shop/ShopView.js";
import {
  friendlyAdminShopActionError,
  type ShopOrderStatus,
} from "../shop/shop-messages.js";

export function AdminShopOrdersPage({
  skipRemote = false,
  isSuperAdmin = false,
}: {
  skipRemote?: boolean;
  isSuperAdmin?: boolean;
}) {
  const [adminToken, setAdminToken] = useState<string | undefined>();
  const [items, setItems] = useState<AdminShopOrderItem[]>([]);
  const [status, setStatus] = useState<ShopOrderStatus | "all">("all");
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
        const listed = await loadAdminShopOrders(token, status);
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
    const listed = await loadAdminShopOrders(token, nextStatus);
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
    } catch (error) {
      setNote(friendlyAdminShopActionError(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminLayout
      isSuperAdmin={isSuperAdmin}
      title="Магазин / Заказы"
      description="Обработка ручных заказов без изменения payout-логики"
      {...(error ? { error } : {})}
    >
      <AdminShopOrdersView
        items={items}
        status={status}
        reason={reason}
        {...(note ? { note } : {})}
        submitting={submitting || skipRemote}
        skipRemote={skipRemote}
        {...(adminToken ? { adminToken } : {})}
        onStatusChange={(next) => {
          setStatus(next);
        }}
        onReasonChange={setReason}
        onProcess={(id) => {
          void runAction(
            () => processAdminShopOrder(adminToken ?? "", id, createIdempotencyKey()),
            "Заказ в обработке",
          );
        }}
        onFulfill={(id) => {
          void runAction(
            () => fulfillAdminShopOrder(adminToken ?? "", id, createIdempotencyKey()),
            "Заказ выполнен",
          );
        }}
        onApproveStream={(submissionId) => {
          void runAction(
            () =>
              approveAdminStreamGif(
                adminToken ?? "",
                submissionId,
                keyForPost(`POST /admin/stream-gifs/${submissionId}/approve`),
              ),
            "Отправлено в очередь стрима",
          );
        }}
        onReject={(id) => {
          if (!reason.trim()) {
            setNote("Укажите причину отклонения");
            return;
          }
          void runAction(
            () =>
              rejectAdminShopOrder(
                adminToken ?? "",
                id,
                reason.trim(),
                createIdempotencyKey(),
              ),
            "Заказ отклонён, AZC возвращены",
          );
        }}
      />
    </AdminLayout>
  );
}

export default AdminShopOrdersPage;
