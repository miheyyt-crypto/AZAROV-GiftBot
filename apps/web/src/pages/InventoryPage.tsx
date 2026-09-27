import { useState } from "react";
import { ApiRequestError, createCashWithdrawal } from "../api.js";
import { BottomSheet } from "../components/BottomSheet.js";
import { EmptyState } from "../components/EmptyState.js";
import { QueryPanel } from "../components/QueryPanel.js";
import { navigate } from "../app/routes.js";
import { createIdempotencyKey } from "../idempotency.js";
import { formatRubAmount } from "../lib/format.js";
import {
  friendlyCashError,
  friendlyCashItemStatus,
  friendlyCashSource,
} from "../profile/cash-messages.js";
import { parseProfileInventory } from "../profile/parse.js";
import { EMPTY_PROFILE_LIST, type ProfileInventoryItem } from "../profile/types.js";
import { useAuthedGet } from "../profile/useAuthedGet.js";
import { CashRubArt } from "../paid-case/RewardArt.js";
import { FreezeArt, ShopProductArt } from "../shop/ShopArt.js";

export function InventoryView({
  items,
  selected,
  welvuraId,
  submitting = false,
  note,
  success = false,
  onSelect,
  onClose,
  onWelvuraChange,
  onSubmit,
  onHistory,
}: {
  items: ProfileInventoryItem[];
  selected?: Extract<ProfileInventoryItem, { type: "cash_rub" }>;
  welvuraId: string;
  submitting?: boolean;
  note?: string;
  success?: boolean;
  onSelect: (item: Extract<ProfileInventoryItem, { type: "cash_rub" }>) => void;
  onClose: () => void;
  onWelvuraChange: (value: string) => void;
  onSubmit: () => void;
  onHistory: () => void;
}) {
  return (
    <BottomSheet
      open
      title="Инвентарь"
      className="sheet--profile"
      onClose={() => navigate("#/profile")}
    >
      {items.length === 0 ? (
        <div className="psheet-empty">
          <EmptyState title="Инвентарь пуст" text="Призы и предметы появятся здесь." />
        </div>
      ) : (
        <div className="inv-grid">
          {items.map((item) => {
            const done = item.status === "consumed";
            if (item.type === "cash_rub") {
              return (
                <article
                  key={item.id}
                  className={done ? "inv-card is-done" : "inv-card"}
                >
                  <div className="inv-card__art">
                    <CashRubArt amount={item.amountRub} />
                    {done ? <span className="inv-card__check" aria-label="Получено">✓</span> : null}
                  </div>
                  <p className="inv-card__name">{formatRubAmount(item.amountRub)}</p>
                  <p className="inv-card__meta">{friendlyCashItemStatus(item.status)}</p>
                  {item.status === "available" ? (
                    <button type="button" className="inv-card__cta" data-interactive="true" onClick={() => onSelect(item)}>
                      Получить
                    </button>
                  ) : null}
                </article>
              );
            }
            if (item.type === "external_prize") {
              return (
                <article key={item.id} className={done ? "inv-card is-done" : "inv-card"}>
                  <div className="inv-card__art">
                    <ShopProductArt code={item.itemCode} title={item.title} />
                    {done ? <span className="inv-card__check" aria-label="Получено">✓</span> : null}
                  </div>
                  <p className="inv-card__name">{item.title}</p>
                  <p className="inv-card__meta">{friendlyCashItemStatus(item.status)}</p>
                </article>
              );
            }
            return (
              <article key={item.id} className={done ? "inv-card is-done" : "inv-card"}>
                <div className="inv-card__art inv-card__art--freeze">
                  <FreezeArt />
                  {done ? <span className="inv-card__check" aria-label="Получено">✓</span> : null}
                </div>
                <p className="inv-card__name">Streak Freeze</p>
                <p className="inv-card__meta">× {String(item.quantity)}</p>
              </article>
            );
          })}
        </div>
      )}
      <button type="button" className="inv-history" data-interactive="true" onClick={onHistory}>
        История ₽ заявок
      </button>
      <BottomSheet
        open={Boolean(selected)}
        title={selected ? formatRubAmount(selected.amountRub) : "Получение приза"}
        className="sheet--nested"
        onClose={onClose}
      >
        {selected ? (
          <div className="stack">
            <p className="muted">{friendlyCashSource(selected.source)}</p>
            <p>
              Укажите Welvura ID. Админ вручную зачислит приз после проверки.
            </p>
            <label className="field">
              Welvura ID
              <input
                value={welvuraId}
                disabled={submitting || success}
                onChange={(event) => onWelvuraChange(event.target.value)}
              />
            </label>
            {note ? <p className="muted">{note}</p> : null}
            {success ? (
              <p>Заявка отправлена</p>
            ) : (
              <button type="button" className="primary" disabled={submitting} onClick={onSubmit}>
                {submitting ? "Отправка…" : "Отправить заявку"}
              </button>
            )}
          </div>
        ) : null}
      </BottomSheet>
    </BottomSheet>
  );
}

export function InventoryPage({
  token,
  skipRemote = false,
}: {
  token: string;
  skipRemote?: boolean;
}) {
  const query = useAuthedGet(
    token,
    "/profile/inventory",
    parseProfileInventory,
    !skipRemote,
    EMPTY_PROFILE_LIST,
    false,
  );
  const [selected, setSelected] = useState<
    Extract<ProfileInventoryItem, { type: "cash_rub" }> | undefined
  >();
  const [welvuraId, setWelvuraId] = useState("");
  const [intentKey, setIntentKey] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState<string | undefined>();
  const [success, setSuccess] = useState(false);

  return (
    <QueryPanel
      status={query.status}
      {...(query.status === "error" ? { errorMessage: query.message } : {})}
      onRetry={query.retry}
      loadingLabel="Загрузка инвентаря"
    >
      <InventoryView
        items={query.status === "ready" ? query.data.items : []}
        {...(selected ? { selected } : {})}
        welvuraId={welvuraId}
        submitting={submitting || skipRemote}
        {...(note ? { note } : {})}
        success={success}
        onSelect={(item) => {
          setSelected(item);
          setWelvuraId("");
          setIntentKey(createIdempotencyKey());
          setNote(undefined);
          setSuccess(false);
        }}
        onClose={() => {
          setSelected(undefined);
          setSuccess(false);
          setNote(undefined);
        }}
        onWelvuraChange={setWelvuraId}
        onSubmit={() => {
          if (!selected || submitting || skipRemote || !intentKey) {
            return;
          }
          const trimmed = welvuraId.trim();
          if (!trimmed) {
            setNote(friendlyCashError("CASH_WITHDRAWAL_INVALID_WELVURA_ID"));
            return;
          }
          setSubmitting(true);
          setNote(undefined);
          void createCashWithdrawal(token, selected.id, trimmed, intentKey)
            .then(async () => {
              setSuccess(true);
              setNote("Заявка создана");
              await query.retry();
            })
            .catch((error: unknown) => {
              setNote(
                friendlyCashError(
                  error instanceof ApiRequestError ? error.code : undefined,
                ),
              );
            })
            .finally(() => {
              setSubmitting(false);
            });
        }}
        onHistory={() => {
          navigate("#/profile/inventory/withdrawals");
        }}
      />
    </QueryPanel>
  );
}

export default InventoryPage;
