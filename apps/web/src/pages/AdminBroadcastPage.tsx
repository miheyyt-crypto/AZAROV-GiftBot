import { useEffect, useState } from "react";
import {
  createAdminBroadcast,
  loadAdminBroadcast,
  loadAdminBroadcastMeta,
  loadAdminBroadcasts,
  uploadAdminBroadcastImage,
} from "../api.js";
import { AdminBroadcastView } from "../admin/AdminBroadcastView.js";
import { AdminConfirmDialog } from "../admin/AdminConfirmDialog.js";
import { AdminLayout } from "../admin/AdminShell.js";
import { resolveAdminBearer } from "../admin/resolve-admin-bearer.js";
import type { AdminBroadcastItem } from "../admin/broadcast-parse.js";
import { clearIdempotencyKey, keyForPost } from "../idempotency.js";

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

export function AdminBroadcastPage({
  skipRemote = false,
  isSuperAdmin = false,
}: {
  skipRemote?: boolean;
  isSuperAdmin?: boolean;
}) {
  const [adminToken, setAdminToken] = useState<string | undefined>();
  const [message, setMessage] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [buttonEnabled, setButtonEnabled] = useState(false);
  const [buttonKind, setButtonKind] = useState<"url" | "web_app">("web_app");
  const [buttonText, setButtonText] = useState("");
  const [buttonUrl, setButtonUrl] = useState("");
  const [recipientCount, setRecipientCount] = useState(0);
  const [items, setItems] = useState<AdminBroadcastItem[]>([]);
  const [active, setActive] = useState<AdminBroadcastItem | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  useEffect(() => {
    if (skipRemote || !isSuperAdmin) {
      return;
    }
    let cancelled = false;
    void resolveAdminBearer()
      .then(async (token) => {
        const [listed, meta] = await Promise.all([
          loadAdminBroadcasts(token),
          loadAdminBroadcastMeta(token),
        ]);
        if (!cancelled) {
          setAdminToken(token);
          setItems(listed.items);
          setRecipientCount(meta.recipientCount);
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

  useEffect(() => {
    if (!adminToken || !active || (active.status !== "sending" && active.status !== "queued")) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadAdminBroadcast(adminToken, active.id)
        .then((row) => {
          setActive(row);
          setItems((current) => current.map((item) => (item.id === row.id ? { ...item, ...row } : item)));
        })
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [adminToken, active]);

  async function refresh(token: string): Promise<void> {
    const [listed, meta] = await Promise.all([
      loadAdminBroadcasts(token),
      loadAdminBroadcastMeta(token),
    ]);
    setItems(listed.items);
    setRecipientCount(meta.recipientCount);
  }

  async function onSendConfirmed(): Promise<void> {
    if (!adminToken || submitting) {
      return;
    }
    setSubmitting(true);
    setNote(undefined);
    try {
      let key = photoKey;
      if (photoFile && !key) {
        const uploaded = await uploadAdminBroadcastImage(adminToken, {
          contentType: photoFile.type,
          imageBase64: await fileToBase64(photoFile),
        });
        key = uploaded.photoKey;
        setPhotoKey(key);
      }
      const route = "POST /admin/broadcasts";
      const created = await createAdminBroadcast(
        adminToken,
        {
          messageText: message,
          ...(key ? { photoKey: key } : {}),
          ...(buttonEnabled
            ? { button: { kind: buttonKind, text: buttonText, url: buttonUrl } }
            : {}),
        },
        keyForPost(route),
      );
      clearIdempotencyKey(route);
      setActive(created);
      setMessage("");
      setPhotoFile(null);
      setPhotoKey(null);
      setNote("Рассылка отправляется");
      await refresh(adminToken);
    } catch {
      setNote("Не удалось отправить рассылку");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminLayout
      isSuperAdmin={isSuperAdmin}
      title="Рассылка в Telegram"
      description="Текст и фото уходят через очередь бота, не из HTTP-запроса"
      {...(error ? { error } : {})}
    >
      <AdminBroadcastView
        message={message}
        photoName={photoFile?.name ?? null}
        photoPreviewUrl={photoPreviewUrl}
        buttonEnabled={buttonEnabled}
        buttonKind={buttonKind}
        buttonText={buttonText}
        buttonUrl={buttonUrl}
        recipientCount={recipientCount}
        items={items}
        active={active}
        submitting={submitting || skipRemote}
        {...(note ? { note } : {})}
        onMessageChange={setMessage}
        onPhotoFile={(file) => {
          if (!ALLOWED.has(file.type) || file.size > MAX_BYTES) {
            setNote("Нужен JPG, PNG или WEBP до 5 МБ");
            return;
          }
          setPhotoFile(file);
          setPhotoKey(null);
          setNote(undefined);
        }}
        onPhotoClear={() => {
          setPhotoFile(null);
          setPhotoKey(null);
        }}
        onButtonEnabledChange={setButtonEnabled}
        onButtonKindChange={setButtonKind}
        onButtonTextChange={setButtonText}
        onButtonUrlChange={setButtonUrl}
        onSend={() => setConfirmOpen(true)}
        onOpen={(id) => {
          if (!adminToken) {
            return;
          }
          void loadAdminBroadcast(adminToken, id).then(setActive);
        }}
      />
      <AdminConfirmDialog
        open={confirmOpen}
        title="Отправить рассылку всем пользователям?"
        body={`Получателей: ${recipientCount}. Фото: ${photoFile ? "да" : "нет"}. ${message.slice(0, 80) || "—"}`}
        confirmLabel="Отправить"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void onSendConfirmed();
        }}
      />
    </AdminLayout>
  );
}

export default AdminBroadcastPage;
