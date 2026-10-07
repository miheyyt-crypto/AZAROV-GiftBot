import { useEffect, useState } from "react";
import { loadAdminStreamDonations, type StreamDonationItem } from "../api.js";
import { AdminLayout } from "../admin/AdminShell.js";
import { AdminStatusBadge } from "../admin/AdminStatusBadge.js";
import { resolveAdminBearer } from "../admin/resolve-admin-bearer.js";
import { formatShortDateTime } from "../lib/format.js";

function statusLabel(status: StreamDonationItem["status"]): string {
  if (status === "queued") {
    return "в очереди";
  }
  if (status === "playing") {
    return "показ";
  }
  return "завершён";
}

export function AdminDonationsPage({
  skipRemote = false,
  isSuperAdmin = false,
}: {
  skipRemote?: boolean;
  isSuperAdmin?: boolean;
}) {
  const [items, setItems] = useState<StreamDonationItem[]>([]);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (skipRemote || !isSuperAdmin) {
      return;
    }
    let cancelled = false;
    void resolveAdminBearer()
      .then(async (token) => {
        const listed = await loadAdminStreamDonations(token);
        if (!cancelled) {
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
  }, [skipRemote, isSuperAdmin]);

  return (
    <AdminLayout
      isSuperAdmin={isSuperAdmin}
      title="Донаты"
      description="Последние донаты на стрим. Повтор показа не списывает монеты и пока не включён."
      {...(error ? { error } : {})}
    >
      {items.length === 0 ? (
        <p className="muted">Пока нет донатов.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Ник</th>
                <th>Сообщение</th>
                <th>AZC</th>
                <th>Статус</th>
                <th>Создан</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.displayName}</td>
                  <td>{item.message}</td>
                  <td>{item.amountAzc}</td>
                  <td>
                    <AdminStatusBadge
                      status={item.status}
                      label={statusLabel(item.status)}
                    />
                  </td>
                  <td>{formatShortDateTime(item.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  );
}

export default AdminDonationsPage;
