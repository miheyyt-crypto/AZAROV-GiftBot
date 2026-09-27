import { useEffect, useState } from "react";
import {
  activateAdminGiveaway,
  cancelAdminGiveaway,
  createAdminGiveaway,
  deliverAdminGiveawayWinner,
  loadAdminGiveawayDetail,
  loadAdminGiveaways,
  patchAdminGiveaway,
  uploadAdminGiveawayImage,
} from "../api.js";
import { AdminConfirmDialog } from "../admin/AdminConfirmDialog.js";
import { AdminGiveawaysView } from "../admin/AdminGiveawaysView.js";
import { AdminLayout } from "../admin/AdminShell.js";
import { resolveAdminBearer } from "../admin/resolve-admin-bearer.js";
import type {
  GiveawayAdminDetail,
  GiveawayAdminListItem,
  GiveawayDbStatus,
  GiveawayType,
} from "../giveaways/types.js";
import { createIdempotencyKey } from "../idempotency.js";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const comma = text.indexOf(",");
      resolve(comma >= 0 ? text.slice(comma + 1) : text);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export function AdminGiveawaysPage({
  skipRemote = false,
  isSuperAdmin = false,
}: {
  skipRemote?: boolean;
  isSuperAdmin?: boolean;
}) {
  const [adminToken, setAdminToken] = useState<string | undefined>();
  const [items, setItems] = useState<GiveawayAdminListItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<GiveawayDbStatus | "all">("all");
  const [creating, setCreating] = useState(true);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<GiveawayType>("coins");
  const [bankAzc, setBankAzc] = useState("");
  const [customPrize, setCustomPrize] = useState("");
  const [winnerCount, setWinnerCount] = useState("1");
  const [endsAt, setEndsAt] = useState("");
  const [reason, setReason] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [note, setNote] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [detail, setDetail] = useState<GiveawayAdminDetail | null>(null);
  const [detailReason, setDetailReason] = useState("");
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (localPreview) {
        URL.revokeObjectURL(localPreview);
      }
    };
  }, [localPreview]);

  useEffect(() => {
    if (skipRemote || !isSuperAdmin) {
      return;
    }
    let cancelled = false;
    void resolveAdminBearer()
      .then(async (token) => {
        const listed = await loadAdminGiveaways(token, { status: statusFilter });
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
  }, [skipRemote, isSuperAdmin, statusFilter]);

  async function refresh(token: string): Promise<void> {
    const listed = await loadAdminGiveaways(token, { status: statusFilter });
    setItems(listed.items);
  }

  function onImageFile(file: File): void {
    if (!ALLOWED.has(file.type) || file.size > MAX_BYTES) {
      setNote("Нужен PNG, JPG или WEBP до 5 МБ.");
      return;
    }
    if (localPreview) {
      URL.revokeObjectURL(localPreview);
    }
    const url = URL.createObjectURL(file);
    setLocalPreview(url);
    setImageFile(file);
    setImagePreviewUrl(url);
    setNote(undefined);
  }

  function onImageClear(): void {
    if (localPreview) {
      URL.revokeObjectURL(localPreview);
    }
    setLocalPreview(null);
    setImageFile(null);
    setImagePreviewUrl(null);
  }

  async function uploadIfNeeded(token: string): Promise<string | null> {
    if (!imageFile) {
      return imagePreviewUrl && imagePreviewUrl.startsWith("/giveaways/media/")
        ? imagePreviewUrl
        : null;
    }
    const imageBase64 = await fileToBase64(imageFile);
    const uploaded = await uploadAdminGiveawayImage(token, {
      contentType: imageFile.type,
      imageBase64,
    });
    return uploaded.imageUrl;
  }

  async function onCreate(): Promise<void> {
    if (!adminToken || submitting) {
      return;
    }
    const winners = Number(winnerCount);
    if (!Number.isInteger(winners) || winners <= 0) {
      setNote("Число победителей должно быть целым > 0.");
      return;
    }
    if (!reason.trim()) {
      setNote("Укажите причину.");
      return;
    }
    setSubmitting(true);
    setNote(undefined);
    try {
      const imageUrl = await uploadIfNeeded(adminToken);
      await createAdminGiveaway(
        adminToken,
        {
          title: title.trim(),
          type,
          winnerCount: winners,
          reason: reason.trim(),
          ...(type === "coins"
            ? { bankAzc: bankAzc.trim() }
            : { customPrize: customPrize.trim() }),
          ...(endsAt.trim() ? { endsAt: endsAt.trim() } : {}),
          ...(imageUrl ? { imageUrl } : {}),
        },
        createIdempotencyKey(),
      );
      setTitle("");
      setBankAzc("");
      setCustomPrize("");
      setWinnerCount("1");
      setEndsAt("");
      setReason("");
      onImageClear();
      setNote("Розыгрыш создан");
      setCreating(false);
      await refresh(adminToken);
    } catch {
      setNote("Не удалось создать розыгрыш");
    } finally {
      setSubmitting(false);
    }
  }

  async function onActivate(id: string): Promise<void> {
    if (!adminToken || submitting) {
      return;
    }
    if (!reason.trim()) {
      setNote("Укажите причину для активации.");
      return;
    }
    setSubmitting(true);
    setNote(undefined);
    try {
      await activateAdminGiveaway(adminToken, id, reason.trim(), createIdempotencyKey());
      setNote("Розыгрыш активирован");
      await refresh(adminToken);
    } catch {
      setNote("Не удалось активировать");
    } finally {
      setSubmitting(false);
    }
  }

  async function onCancelConfirmed(id: string): Promise<void> {
    if (!adminToken || submitting) {
      return;
    }
    if (!reason.trim()) {
      setNote("Укажите причину для отмены.");
      setCancelTarget(null);
      return;
    }
    setSubmitting(true);
    setNote(undefined);
    try {
      await cancelAdminGiveaway(adminToken, id, reason.trim(), createIdempotencyKey());
      setNote("Розыгрыш отменён");
      await refresh(adminToken);
    } catch {
      setNote("Не удалось отменить");
    } finally {
      setSubmitting(false);
      setCancelTarget(null);
    }
  }

  async function onOpenDetail(id: string): Promise<void> {
    if (!adminToken) {
      return;
    }
    setNote(undefined);
    try {
      const loaded = await loadAdminGiveawayDetail(adminToken, id);
      setDetail(loaded);
      setImagePreviewUrl(loaded.giveaway.imageUrl);
    } catch {
      setNote("Не удалось открыть детали");
    }
  }

  async function onSaveDraftImage(id: string): Promise<void> {
    if (!adminToken || submitting) {
      return;
    }
    if (!reason.trim()) {
      setNote("Укажите причину для сохранения изображения.");
      return;
    }
    setSubmitting(true);
    setNote(undefined);
    try {
      const imageUrl = await uploadIfNeeded(adminToken);
      await patchAdminGiveaway(
        adminToken,
        id,
        { imageUrl, reason: reason.trim() },
        createIdempotencyKey(),
      );
      setNote("Изображение обновлено");
      const loaded = await loadAdminGiveawayDetail(adminToken, id);
      setDetail(loaded);
      await refresh(adminToken);
    } catch {
      setNote("Не удалось сохранить изображение");
    } finally {
      setSubmitting(false);
    }
  }

  async function onDeliver(giveawayId: string, winnerUserId: string): Promise<void> {
    if (!adminToken || submitting) {
      return;
    }
    const deliverReason = detailReason.trim() || reason.trim();
    if (!deliverReason) {
      setNote("Укажите причину выдачи.");
      return;
    }
    setSubmitting(true);
    setNote(undefined);
    try {
      await deliverAdminGiveawayWinner(
        adminToken,
        giveawayId,
        winnerUserId,
        deliverReason,
        createIdempotencyKey(),
      );
      setNote("Приз отмечен выданным");
      const loaded = await loadAdminGiveawayDetail(adminToken, giveawayId);
      setDetail(loaded);
      await refresh(adminToken);
    } catch {
      setNote("Не удалось отметить выдачу");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminLayout
      isSuperAdmin={isSuperAdmin}
      title="Розыгрыши"
      description="Создание, редактирование и контроль розыгрышей"
      {...(error ? { error } : {})}
    >
      <AdminGiveawaysView
        items={items}
        statusFilter={statusFilter}
        title={title}
        type={type}
        bankAzc={bankAzc}
        customPrize={customPrize}
        winnerCount={winnerCount}
        endsAt={endsAt}
        reason={reason}
        imagePreviewUrl={imagePreviewUrl}
        {...(note ? { note } : {})}
        submitting={submitting || skipRemote}
        creating={creating}
        detail={detail}
        detailReason={detailReason}
        onStatusFilterChange={setStatusFilter}
        onTitleChange={setTitle}
        onTypeChange={setType}
        onBankChange={setBankAzc}
        onCustomPrizeChange={setCustomPrize}
        onWinnerCountChange={setWinnerCount}
        onEndsAtChange={setEndsAt}
        onReasonChange={setReason}
        onImageFile={onImageFile}
        onImageClear={onImageClear}
        onToggleCreate={() => setCreating((open) => !open)}
        onCreate={() => {
          void onCreate();
        }}
        onActivate={(id) => {
          void onActivate(id);
        }}
        onCancel={(id) => setCancelTarget(id)}
        onOpenDetail={(id) => {
          void onOpenDetail(id);
        }}
        onCloseDetail={() => setDetail(null)}
        onDetailReasonChange={setDetailReason}
        onDeliver={(giveawayId, winnerUserId) => {
          void onDeliver(giveawayId, winnerUserId);
        }}
        onSaveDraftImage={(id) => {
          void onSaveDraftImage(id);
        }}
      />
      <AdminConfirmDialog
        open={cancelTarget != null}
        title="Отменить розыгрыш?"
        body="Отмена необратима для текущей логики продукта. Укажите причину в форме."
        confirmLabel="Отменить"
        danger
        onCancel={() => setCancelTarget(null)}
        onConfirm={() => {
          if (cancelTarget) {
            void onCancelConfirmed(cancelTarget);
          }
        }}
      />
    </AdminLayout>
  );
}

export default AdminGiveawaysPage;
