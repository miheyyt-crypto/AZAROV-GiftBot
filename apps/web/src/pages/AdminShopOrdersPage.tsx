import { useEffect, useState } from "react";
import {
  approveAdminStreamGif,
  fulfillAdminShopOrder,
  loadAdminShopOrders,
  loadAdminStreamGifs,
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
import {
  streamGifApproveSuccessNote,
  type StreamGifModerationSnapshot,
  type StreamOrderBinding,
} from "../shop/shop-stream-order.js";

export function AdminShopOrdersPage({
  skipRemote = false,
  isSuperAdmin = false,
}: {
  skipRemote?: boolean;
  isSuperAdmin?: boolean;
}) {
  const [adminToken, setAdminToken] = useState<string | undefined>();
  const [items, setItems] = useState<AdminShopOrderItem[]>([]);
  const [streamMedia, setStreamMedia] = useState<
    Record<string, StreamGifModerationSnapshot>
  >({});
  const [status, setStatus] = useState<ShopOrderStatus | "all">("all");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | undefined>();
  const [noteItemId, setNoteItemId] = useState<string | undefined>();
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
        const gifs = await loadAdminStreamGifs(token);
        if (!cancelled) {
          setAdminToken(token);
          setItems(listed.items);
          setStreamMedia(snapshotStreamMedia(gifs.items));
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
    const gifs = await loadAdminStreamGifs(token);
    setItems(listed.items);
    setStreamMedia(snapshotStreamMedia(gifs.items));
  }

  async function runAction(
    action: () => Promise<unknown>,
    success: string,
    itemId?: string,
  ): Promise<void> {
    if (!adminToken || submitting) {
      return;
    }
    setSubmitting(true);
    setNote(undefined);
    setNoteItemId(itemId);
    try {
      const result = await action();
      setNote(typeof result === "string" && result.length > 0 ? result : success);
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
        {...(noteItemId ? { noteItemId } : {})}
        streamMedia={streamMedia}
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
            id,
          );
        }}
        onFulfill={(id) => {
          void runAction(
            () => fulfillAdminShopOrder(adminToken ?? "", id, createIdempotencyKey()),
            "Заказ выполнен",
            id,
          );
        }}
        onApproveStream={(binding: StreamOrderBinding) => {
          void runAction(
            async () => {
              const approved = await approveAdminStreamGif(
                adminToken ?? "",
                binding.submissionId,
                keyForPost(
                  `POST /admin/stream-gifs/${binding.submissionId}/approve`,
                ),
              );
              return streamGifApproveSuccessNote({
                enqueued: approved.enqueued,
                replayed: approved.replayed,
                status: approved.item.status,
                orderId: approved.item.orderId ?? binding.orderId,
              });
            },
            `В очереди · заказ ${binding.orderId.slice(0, 8)}`,
            binding.orderId,
          );
        }}
        onReject={(id) => {
          if (!reason.trim()) {
            setNoteItemId(id);
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
            id,
          );
        }}
      />
    </AdminLayout>
  );
}

function snapshotStreamMedia(
  items: Array<{
    id: string;
    orderId: string | null;
    donationId: string | null;
    status: StreamGifModerationSnapshot["status"];
    playbackReady?: boolean;
    displayName?: string | null;
  }>,
): Record<string, StreamGifModerationSnapshot> {
  const next: Record<string, StreamGifModerationSnapshot> = {};
  for (const item of items) {
    next[item.id] = {
      id: item.id,
      orderId: item.orderId,
      donationId: item.donationId,
      status: item.status,
      ...(item.playbackReady === undefined
        ? {}
        : { playbackReady: item.playbackReady }),
      ...(item.displayName === undefined ? {} : { displayName: item.displayName }),
    };
  }
  return next;
}

export default AdminShopOrdersPage;
