import { useEffect, useState } from "react";
import { AdminStreamMediaPreview } from "../admin/AdminStreamMediaPreview.js";
import {
  approveAdminStreamGif,
  dismissPlayingStreamGif,
  loadAdminStreamGifBlob,
  loadAdminStreamGifs,
  rejectAdminStreamGif,
  type StreamGifAdminItem,
} from "../api.js";
import { AdminLayout } from "../admin/AdminShell.js";
import { AdminStatusBadge } from "../admin/AdminStatusBadge.js";
import { resolveAdminBearer } from "../admin/resolve-admin-bearer.js";
import { formatShortDateTime } from "../lib/format.js";
import { keyForPost } from "../idempotency.js";
import { friendlyAdminShopActionError } from "../shop/shop-messages.js";

function GifPreview({
  id,
  skipRemote,
  contentType,
  adminToken,
}: {
  id: string;
  skipRemote: boolean;
  contentType?: string;
  adminToken?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (skipRemote) {
      return;
    }
    let revoked: string | null = null;
    let cancelled = false;
    const tokenPromise = adminToken
      ? Promise.resolve(adminToken)
      : resolveAdminBearer();
    void tokenPromise
      .then((token) => loadAdminStreamGifBlob(token, id))
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        revoked = url;
        setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (revoked) {
        URL.revokeObjectURL(revoked);
      }
    };
  }, [id, skipRemote, adminToken]);
  return (
    <AdminStreamMediaPreview
      src={src}
      placeholder="медиа"
      {...(contentType ? { contentType } : {})}
    />
  );
}

function statusLabel(status: StreamGifAdminItem["status"]): string {
  switch (status) {
    case "pending_moderation":
      return "На модерации";
    case "queued":
      return "В очереди";
    case "playing":
      return "Показывается";
    case "shown":
      return "Показан";
    case "rejected":
      return "Отклонён";
  }
}

export function AdminStreamGifsPage({
  skipRemote = false,
  isSuperAdmin = false,
}: {
  skipRemote?: boolean;
  isSuperAdmin?: boolean;
}) {
  const [items, setItems] = useState<StreamGifAdminItem[]>([]);
  const [adminToken, setAdminToken] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState(false);

  async function refresh(token: string): Promise<void> {
    const listed = await loadAdminStreamGifs(token);
    setItems(listed.items);
  }

  useEffect(() => {
    if (skipRemote || !isSuperAdmin) {
      return;
    }
    let cancelled = false;
    void resolveAdminBearer()
      .then(async (token) => {
        if (!cancelled) {
          setAdminToken(token);
        }
        await refresh(token);
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
  }, [skipRemote, isSuperAdmin]);

  async function withAdmin(
    run: (token: string) => Promise<void>,
  ): Promise<void> {
    const token = await resolveAdminBearer();
    await run(token);
    await refresh(token);
  }

  return (
    <AdminLayout
      isSuperAdmin={isSuperAdmin}
      title="Медиа на стрим"
      description="Модерация фото, GIF и видео перед показом в OBS. Одобрение ставит файл в общую очередь алертов."
      {...(error ? { error } : {})}
    >
      <div className="admin-toolbar">
        <button
          type="button"
          className="admin-btn admin-btn--secondary"
          disabled={dismissing || skipRemote}
          onClick={() => {
            setDismissing(true);
            void withAdmin((token) => dismissPlayingStreamGif(token))
              .catch(() => {
                setError("Сейчас нет медиа на экране");
              })
              .finally(() => {
                setDismissing(false);
              });
          }}
        >
          Убрать с экрана
        </button>
      </div>
      {items.length === 0 ? (
        <p className="muted">Пока нет заявок.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Превью</th>
                <th>Автор</th>
                <th>Заказ</th>
                <th>Статус</th>
                <th>Время</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <GifPreview
                      id={item.id}
                      skipRemote={skipRemote}
                      {...(adminToken ? { adminToken } : {})}
                      {...(item.contentType ? { contentType: item.contentType } : {})}
                    />
                  </td>
                  <td>{item.displayName ?? item.publicId ?? item.userId}</td>
                  <td>{item.orderId ? item.orderId.slice(0, 8) : "—"}</td>
                  <td>
                    <AdminStatusBadge
                      status={item.status}
                      label={statusLabel(item.status)}
                    />
                    {item.playbackOutcome === "failed" ? (
                      <p className="muted">ошибка загрузки</p>
                    ) : null}
                    {item.playbackOutcome === "dismissed" ? (
                      <p className="muted">снят с экрана</p>
                    ) : null}
                    {item.rejectionReason ? (
                      <p className="muted">{item.rejectionReason}</p>
                    ) : null}
                  </td>
                  <td>{formatShortDateTime(item.createdAt)}</td>
                  <td>
                    {item.status === "pending_moderation" ? (
                      <>
                        <button
                          type="button"
                          className="admin-btn admin-btn--success"
                          disabled={busyId === item.id || skipRemote}
                          onClick={() => {
                            setBusyId(item.id);
                            void withAdmin((token) =>
                              approveAdminStreamGif(
                                token,
                                item.id,
                                keyForPost(`POST /admin/stream-gifs/${item.id}/approve`),
                              ).then((approved) => {
                                if (!approved.enqueued && !approved.replayed) {
                                  throw new Error("approve did not enqueue");
                                }
                              }),
                            )
                              .catch((err: unknown) => {
                                setError(friendlyAdminShopActionError(err));
                              })
                              .finally(() => setBusyId(null));
                          }}
                        >
                          Одобрить
                        </button>
                        <button
                          type="button"
                          className="admin-btn admin-btn--danger"
                          disabled={busyId === item.id || skipRemote}
                          onClick={() => {
                            const reason = window.prompt("Причина отклонения");
                            if (!reason || reason.trim().length === 0) {
                              return;
                            }
                            setBusyId(item.id);
                            void withAdmin((token) =>
                              rejectAdminStreamGif(
                                token,
                                item.id,
                                reason.trim(),
                                keyForPost(`POST /admin/stream-gifs/${item.id}/reject`),
                              ),
                            )
                              .catch((err: unknown) => {
                                setError(friendlyAdminShopActionError(err));
                              })
                              .finally(() => setBusyId(null));
                          }}
                        >
                          Отклонить
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  );
}

export default AdminStreamGifsPage;
