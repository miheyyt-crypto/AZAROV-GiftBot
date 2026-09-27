import { useEffect, useState } from "react";
import {
  createAdminReferralContest,
  finalizeAdminReferralContest,
  loadAdminReferralContestDetail,
  loadAdminReferralContests,
} from "../api.js";
import { AdminConfirmDialog } from "../admin/AdminConfirmDialog.js";
import { AdminContestReferralView } from "../admin/AdminContestReferralView.js";
import { AdminLayout } from "../admin/AdminShell.js";
import { resolveAdminBearer } from "../admin/resolve-admin-bearer.js";
import { createIdempotencyKey } from "../idempotency.js";
import type { AdminReferralContestDetail, AdminReferralContestListItem } from "../contest/types.js";

const EMPTY_PRIZES = [
  "25000",
  "17000",
  "15000",
  "10000",
  "8000",
  "7000",
  "6000",
  "5000",
  "4000",
  "3000",
];

export function AdminContestReferralPage({
  skipRemote = false,
  isSuperAdmin = false,
}: {
  skipRemote?: boolean;
  isSuperAdmin?: boolean;
}) {
  const [adminToken, setAdminToken] = useState<string | undefined>();
  const [items, setItems] = useState<AdminReferralContestListItem[]>([]);
  const [prizes, setPrizes] = useState(EMPTY_PRIZES);
  const [startNow, setStartNow] = useState(true);
  const [startAt, setStartAt] = useState("");
  const [note, setNote] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [detail, setDetail] = useState<AdminReferralContestDetail | null>(null);
  const [confirmFinalize, setConfirmFinalize] = useState(false);

  useEffect(() => {
    if (skipRemote || !isSuperAdmin) {
      return;
    }
    let cancelled = false;
    void resolveAdminBearer()
      .then(async (token) => {
        const listed = await loadAdminReferralContests(token);
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
    const listed = await loadAdminReferralContests(token);
    setItems(listed.items);
  }

  async function onCreate(): Promise<void> {
    if (!adminToken || submitting) {
      return;
    }
    setSubmitting(true);
    setNote(undefined);
    try {
      await createAdminReferralContest(
        adminToken,
        {
          startNow,
          ...(startNow || !startAt
            ? {}
            : { startAt: new Date(startAt).toISOString() }),
          prizes: prizes.map((rewardAzc, index) => ({
            place: index + 1,
            rewardAzc: rewardAzc.trim(),
          })),
        },
        createIdempotencyKey(),
      );
      setPrizes(EMPTY_PRIZES);
      await refresh(adminToken);
      setNote("Конкурс создан");
    } catch {
      setNote("Не удалось создать. Проверьте призы и что нет другого открытого конкурса.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminLayout
      isSuperAdmin={isSuperAdmin}
      title="Реферальный конкурс"
      description="Один активный баттл, призы из API, финализация без двойной выплаты."
      {...(error ? { error } : {})}
    >
      <AdminContestReferralView
        items={items}
        prizes={prizes}
        startNow={startNow}
        startAt={startAt}
        {...(note ? { note } : {})}
        submitting={submitting}
        detail={detail}
        onPrizeChange={(index, value) => {
          setPrizes((current) => current.map((row, i) => (i === index ? value : row)));
        }}
        onStartNowChange={setStartNow}
        onStartAtChange={setStartAt}
        onCreate={() => {
          void onCreate();
        }}
        onOpenDetail={(id) => {
          if (!adminToken) {
            return;
          }
          void loadAdminReferralContestDetail(adminToken, id).then(setDetail);
        }}
        onCloseDetail={() => setDetail(null)}
        onFinalize={() => setConfirmFinalize(true)}
      />
      <AdminConfirmDialog
        open={confirmFinalize}
        title="Завершить конкурс?"
        body="Награды начислятся один раз. Повторный запуск не выдаст монеты дважды."
        confirmLabel="Finalize"
        onCancel={() => setConfirmFinalize(false)}
        onConfirm={() => {
          setConfirmFinalize(false);
          if (!adminToken || !detail) {
            return;
          }
          void finalizeAdminReferralContest(
            adminToken,
            detail.contest.id,
            createIdempotencyKey(),
          )
            .then(async () => {
              const next = await loadAdminReferralContestDetail(
                adminToken,
                detail.contest.id,
              );
              setDetail(next);
              await refresh(adminToken);
            })
            .catch(() => setNote("Finalize не удался"));
        }}
      />
    </AdminLayout>
  );
}

export default AdminContestReferralPage;
