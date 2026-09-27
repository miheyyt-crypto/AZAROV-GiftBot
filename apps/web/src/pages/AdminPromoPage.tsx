import { useEffect, useState } from "react";
import {
  createAdminPromoCode,
  deactivateAdminPromoCode,
  loadAdminPromoCodes,
  type AdminPromoItem,
} from "../api.js";
import { AdminPromoView } from "../admin/AdminPromoView.js";
import { AdminConfirmDialog } from "../admin/AdminConfirmDialog.js";
import { AdminLayout } from "../admin/AdminShell.js";
import { resolveAdminBearer } from "../admin/resolve-admin-bearer.js";
import { createIdempotencyKey } from "../idempotency.js";

export function AdminPromoPage({
  skipRemote = false,
  isSuperAdmin = false,
}: {
  skipRemote?: boolean;
  isSuperAdmin?: boolean;
}) {
  const [adminToken, setAdminToken] = useState<string | undefined>();
  const [items, setItems] = useState<AdminPromoItem[]>([]);
  const [code, setCode] = useState("");
  const [rewardAzc, setRewardAzc] = useState("");
  const [activationLimit, setActivationLimit] = useState("");
  const [note, setNote] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (skipRemote || !isSuperAdmin) {
      return;
    }
    let cancelled = false;
    void resolveAdminBearer()
      .then(async (token) => {
        const listed = await loadAdminPromoCodes(token);
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
  }, [skipRemote, isSuperAdmin]);

  async function refresh(token: string): Promise<void> {
    const listed = await loadAdminPromoCodes(token);
    setItems(listed.items);
  }

  async function onCreate(): Promise<void> {
    if (!adminToken || submitting) {
      return;
    }
    const limit = Number(activationLimit);
    if (!Number.isInteger(limit)) {
      setNote("Лимит должен быть целым числом.");
      return;
    }
    setSubmitting(true);
    setNote(undefined);
    try {
      await createAdminPromoCode(
        adminToken,
        { code: code.trim(), rewardAzc: rewardAzc.trim(), activationLimit: limit },
        createIdempotencyKey(),
      );
      setCode("");
      setRewardAzc("");
      setActivationLimit("");
      setNote("Промокод создан");
      await refresh(adminToken);
    } catch {
      setNote("Не удалось создать промокод");
    } finally {
      setSubmitting(false);
    }
  }

  async function onDeactivate(id: string): Promise<void> {
    if (!adminToken || submitting) {
      return;
    }
    setSubmitting(true);
    setNote(undefined);
    try {
      await deactivateAdminPromoCode(adminToken, id, createIdempotencyKey());
      setNote("Промокод деактивирован");
      await refresh(adminToken);
    } catch {
      setNote("Не удалось деактивировать промокод");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminLayout
      isSuperAdmin={isSuperAdmin}
      title="Промокоды"
      description="Создание и деактивация промокодов"
      {...(error ? { error } : {})}
    >
      <AdminPromoView
        items={items}
        code={code}
        rewardAzc={rewardAzc}
        activationLimit={activationLimit}
        {...(note ? { note } : {})}
        submitting={submitting || skipRemote}
        onCodeChange={setCode}
        onRewardChange={setRewardAzc}
        onLimitChange={setActivationLimit}
        onCreate={() => {
          void onCreate();
        }}
        onDeactivate={(id) => setConfirmId(id)}
      />
      <AdminConfirmDialog
        open={confirmId != null}
        title="Деактивировать промокод?"
        body="Код перестанет приниматься. Начисления уже выданные не отменяются."
        confirmLabel="Деактивировать"
        danger
        onCancel={() => setConfirmId(null)}
        onConfirm={() => {
          if (confirmId) {
            void onDeactivate(confirmId);
            setConfirmId(null);
          }
        }}
      />
    </AdminLayout>
  );
}

export default AdminPromoPage;
