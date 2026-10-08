import { useEffect, useState } from "react";
import { loadAdminStreamGifBlob } from "../api.js";
import { resolveAdminBearer } from "../admin/resolve-admin-bearer.js";
import { BottomSheet } from "../components/BottomSheet.js";
import { GameBanners } from "../components/GameBanners.js";
import { BalanceBadge } from "../components/BalanceBadge.js";
import { CoinAmount } from "../components/CoinAmount.js";
import {
  IconCaseCube,
  IconCart,
  IconInfo,
  IconLock,
  IconShopBag,
} from "../assets/icons.js";
import { ShopOrderSuccessPopup, type ShopSuccessOrder } from "./ShopOrderSuccessPopup.js";
import { PaidCaseSheet } from "../paid-case/PaidCaseSheet.js";
import type {
  PaidCaseCatalog,
  PaidCaseOpenResult,
} from "../paid-case/types.js";
import { ReferralCaseSheet } from "../referral-case/ReferralCaseSheet.js";
import type {
  ReferralCaseCatalog,
  ReferralCaseOpenResult,
} from "../referral-case/types.js";
import type { ProfileOrder } from "../profile/types.js";
import { formatShortDateTime, shortPublicId } from "../lib/format.js";
import { EMPTY_REFERRAL_ME, type ReferralMeSummary } from "../referrals/types.js";
import {
  ShopCaseArt,
  ShopProductArt,
  shopProductCtaTone,
  shopProductTone,
} from "./ShopArt.js";
import {
  friendlyShopStatus,
  isRetiredShopProduct,
  shopPayloadDetailLabel,
  type ShopCatalogProduct,
  type ShopCategory,
  type ShopOrderStatus,
  type ShopRequiredField,
} from "./shop-messages.js";
import {
  canApproveStreamOrder,
  streamGifPlaybackLabel,
  streamOrderBinding,
  type StreamGifModerationSnapshot,
  type StreamOrderBinding,
} from "./shop-stream-order.js";
import {
  SHOP_SHEET_FIELD_LABEL,
  canAffordAzc,
  caseCashBadge,
  caseTitle,
  remainingInviteCopy,
  shopFieldMax,
  shopFieldPlaceholder,
} from "./shop-ui.js";

const SHOP_TABS = [
  { id: "store" as const, label: "Магазин" },
  { id: "cases" as const, label: "Кейсы" },
];

const FILTERS: { id: ShopFilter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "money", label: "Деньги" },
  { id: "donations", label: "Донаты" },
  { id: "subs", label: "Подписки" },
  { id: "other", label: "Другое" },
];

export type ShopFilter = "all" | ShopCategory;

export function ShopView({
  catalog,
  paidCases = [],
  balanceAzc,
  mainTab,
  filter,
  selected,
  fields,
  submitting = false,
  note,
  success = false,
  successOrder,
  selectedPaidCase = null,
  caseOpening = false,
  caseAnimating = false,
  caseResult = null,
  caseErrorNote,
  showCaseResult = false,
  referralProgress = EMPTY_REFERRAL_ME.caseProgress,
  onMainTabChange,
  onFilterChange,
  onSelect,
  onClose,
  onFieldChange,
  gifPreviewUrl,
  gifPreviewKind = "image",
  onGifFile,
  onBuy,
  onOrders,
  onDismissSuccess,
  onSelectPaidCase,
  onClosePaidCase,
  onOpenPaidCase,
  onClosePaidCaseResult,
  referralCatalog = null,
  referralOpening = false,
  referralAnimating = false,
  referralResult = null,
  referralErrorNote,
  showReferralResult = false,
  onSelectReferralCase,
  onCloseReferralCase,
  onOpenReferralCase,
  onCloseReferralCaseResult,
}: {
  catalog: ShopCatalogProduct[];
  paidCases?: PaidCaseCatalog[];
  balanceAzc: string;
  mainTab: "store" | "cases";
  filter: ShopFilter;
  selected?: ShopCatalogProduct;
  fields: Record<string, string>;
  submitting?: boolean;
  note?: string;
  success?: boolean;
  successOrder?: ShopSuccessOrder;
  selectedPaidCase?: PaidCaseCatalog | null;
  caseOpening?: boolean;
  caseAnimating?: boolean;
  caseResult?: PaidCaseOpenResult | null;
  caseErrorNote?: string;
  showCaseResult?: boolean;
  referralProgress?: ReferralMeSummary["caseProgress"];
  onMainTabChange: (tab: "store" | "cases") => void;
  onFilterChange: (filter: ShopFilter) => void;
  onSelect: (product: ShopCatalogProduct) => void;
  onClose: () => void;
  onFieldChange: (field: string, value: string) => void;
  gifPreviewUrl?: string | null;
  gifPreviewKind?: "image" | "video";
  onGifFile?: (file: File | null) => void;
  onBuy: () => void;
  onOrders: () => void;
  onDismissSuccess?: () => void;
  onSelectPaidCase?: (paidCase: PaidCaseCatalog) => void;
  onClosePaidCase?: () => void;
  onOpenPaidCase?: () => void;
  onClosePaidCaseResult?: () => void;
  referralCatalog?: ReferralCaseCatalog | null;
  referralOpening?: boolean;
  referralAnimating?: boolean;
  referralResult?: ReferralCaseOpenResult | null;
  referralErrorNote?: string;
  showReferralResult?: boolean;
  onSelectReferralCase?: () => void;
  onCloseReferralCase?: () => void;
  onOpenReferralCase?: () => void;
  onCloseReferralCaseResult?: () => void;
}) {
  const products = catalog.filter(
    (item) =>
      !isRetiredShopProduct(item) &&
      (filter === "all" || item.category === filter),
  );
  const insufficient = selected ? !canAffordAzc(balanceAzc, selected.priceAzc) : false;
  const invite = remainingInviteCopy(
    referralProgress.current,
    referralProgress.target,
  );
  const referralReady = referralProgress.availableCases > 0;
  const popupOrder: ShopSuccessOrder | undefined = success
    ? successOrder ??
      (selected
        ? {
            orderId: "",
            productTitle: selected.title,
            productCode: selected.code,
            priceAzc: selected.priceAzc,
            fulfillmentType: selected.fulfillmentType,
          }
        : undefined)
    : undefined;

  return (
    <div className="stack shop-page">
      <header className="shop-header">
        <h1>{mainTab === "cases" ? "Кейсы" : "Магазин"}</h1>
        <BalanceBadge amountAzcString={balanceAzc} />
      </header>
      <div className="shop-tabs" role="tablist">
        {SHOP_TABS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={option.id === mainTab}
            className={
              option.id === mainTab ? "shop-tabs__item is-active" : "shop-tabs__item"
            }
            onClick={() => onMainTabChange(option.id)}
          >
            {option.id === "store" ? <IconShopBag size={18} /> : <IconCaseCube size={18} />}
            {option.label}
          </button>
        ))}
      </div>

      {mainTab === "store" ? (
        <>
          <GameBanners className="shop-games" />
          <button type="button" className="shop-orders-link" onClick={onOrders}>
            Мои заказы
            <span aria-hidden="true">›</span>
          </button>
          <div className="shop-chips" role="tablist">
            {FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={option.id === filter}
                className={
                  option.id === filter ? "shop-chip is-active" : "shop-chip"
                }
                onClick={() => onFilterChange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="shop-product-grid">
            {products.map((product) => {
              const tone = shopProductTone(product.code, product.category);
              const ctaTone = shopProductCtaTone(product.code, product.category);
              return (
                <button
                  key={product.code}
                  type="button"
                  className={`shop-product-card shop-product-card--${tone}`}
                  onClick={() => onSelect(product)}
                >
                  <div className="shop-product-card__art">
                    <ShopProductArt code={product.code} title={product.title} />
                  </div>
                  <p className="shop-product-card__title">{product.title}</p>
                  <span className={`shop-product-card__cta shop-product-card__cta--${ctaTone}`}>
                    <CoinAmount amount={product.priceAzc} size={13} />
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="shop-case-grid" data-testid="paid-cases-list">
          {paidCases.map((item) => {
            const badge = caseCashBadge(item.items);
            return (
              <article
                key={item.code}
                className={`shop-case-card shop-case-card--${item.code}`}
              >
                <span className="shop-case-card__rim" aria-hidden="true" />
                <button
                  type="button"
                  className="shop-case-card__hit"
                  onClick={() => onSelectPaidCase?.(item)}
                  data-testid={`paid-case-card-${item.code}`}
                >
                  <div className="shop-case-card__visual">
                    <ShopCaseArt code={item.code} />
                    {badge ? <span className="shop-case-card__badge">{badge}</span> : null}
                    <p className="shop-case-card__title">{caseTitle(item.title)}</p>
                  </div>
                  <span className="shop-case-card__price">
                    <CoinAmount amount={item.priceAzc} size={13} />
                  </span>
                </button>
                <button
                  type="button"
                  className="shop-case-card__inside"
                  onClick={() => onSelectPaidCase?.(item)}
                >
                  Что внутри
                </button>
              </article>
            );
          })}
          <article className="shop-case-card shop-case-card--referral">
            <span className="shop-case-card__rim" aria-hidden="true" />
            <button
              type="button"
              className="shop-case-card__hit"
              onClick={() => onSelectReferralCase?.()}
              data-testid="referral-case-link"
            >
              <div className="shop-case-card__visual">
                <ShopCaseArt code="referral" />
                <span className="shop-case-card__badge">
                  Каждые {referralProgress.target} активных
                </span>
                <p className="shop-case-card__title">Реферальный кейс</p>
              </div>
              {referralReady ? (
                <span className="shop-case-card__price">
                  Доступно: {referralProgress.availableCases}
                </span>
              ) : (
                <span className="shop-case-card__lock">
                  <IconLock size={16} />
                  {invite.label}
                </span>
              )}
            </button>
            <button
              type="button"
              className="shop-case-card__inside"
              onClick={() => onSelectReferralCase?.()}
            >
              Что внутри
            </button>
          </article>
          <PaidCaseSheet
            paidCase={selectedPaidCase}
            balanceAzc={balanceAzc}
            opening={caseOpening}
            animating={caseAnimating}
            result={caseResult}
            {...(caseErrorNote ? { errorNote: caseErrorNote } : {})}
            showResultModal={showCaseResult}
            onClose={() => onClosePaidCase?.()}
            onOpen={() => onOpenPaidCase?.()}
            onCloseResult={() => onClosePaidCaseResult?.()}
          />
          <ReferralCaseSheet
            catalog={referralCatalog}
            availableCases={
              referralCatalog?.availableCases ?? referralProgress.availableCases
            }
            opening={referralOpening}
            animating={referralAnimating}
            result={referralResult}
            {...(referralErrorNote ? { errorNote: referralErrorNote } : {})}
            showResultModal={showReferralResult}
            onClose={() => onCloseReferralCase?.()}
            onOpen={() => onOpenReferralCase?.()}
            onCloseResult={() => onCloseReferralCaseResult?.()}
          />
        </div>
      )}

      <BottomSheet
        open={Boolean(selected)}
        title={selected?.title ?? "Товар"}
        onClose={onClose}
        className="sheet--shop-product"
      >
        {selected ? (
          <form
            className="shop-product-sheet"
            onSubmit={(event) => {
              event.preventDefault();
              onBuy();
            }}
          >
            <div className="shop-product-sheet__art">
              <ShopProductArt code={selected.code} title={selected.title} />
            </div>
            <p className="shop-product-sheet__price">
              <CoinAmount amount={selected.priceAzc} size={22} />
            </p>
            <p className="shop-product-sheet__desc">{selected.description}</p>
            <div className="shop-product-sheet__info">
              <IconInfo size={16} />
              <p>
                {selected.code === "donat"
                  ? "Сообщение появится на стриме автоматически."
                  : selected.code === "gif-stream"
                    ? "JPG, PNG, WebP, GIF, MP4, MOV, WebM · до 10 МБ · показ 7 секунд после модерации."
                  : selected.fulfillmentType === "instant"
                    ? "Награда сразу попадёт в инвентарь."
                    : "Заявку обработает администратор — статус увидишь в «Моих заказах»."}
              </p>
            </div>
            {selected.requiredFields.map((field) =>
              field === "gifUploadId" ? (
                <ShopGifField
                  key={field}
                  previewUrl={gifPreviewUrl ?? null}
                  previewKind={gifPreviewKind}
                  disabled={submitting}
                  onFile={(file) => onGifFile?.(file)}
                />
              ) : (
                <ShopField
                  key={field}
                  field={field}
                  productCode={selected.code}
                  value={fields[field] ?? ""}
                  onChange={(value) => onFieldChange(field, value)}
                />
              ),
            )}
            <button
              type="submit"
              className={
                insufficient
                  ? "shop-product-sheet__cta is-blocked"
                  : `shop-product-sheet__cta shop-product-sheet__cta--${shopProductCtaTone(selected.code, selected.category)}`
              }
              disabled={submitting || insufficient}
            >
              {submitting ? "Покупка…" : insufficient ? "Не хватает монет" : "Купить"}
            </button>
            {note ? <p className="muted">{note}</p> : null}
          </form>
        ) : null}
      </BottomSheet>
      {success && popupOrder ? (
        <ShopOrderSuccessPopup
          order={popupOrder}
          onClose={() => onDismissSuccess?.()}
          onOrders={() => {
            onDismissSuccess?.();
            onOrders();
          }}
        />
      ) : null}
    </div>
  );
}

function ShopGifField({
  previewUrl,
  previewKind,
  disabled,
  onFile,
}: {
  previewUrl: string | null;
  previewKind: "image" | "video";
  disabled: boolean;
  onFile: (file: File | null) => void;
}) {
  const previewStyle = {
    marginTop: "0.6rem",
    maxWidth: "100%",
    maxHeight: "180px",
    objectFit: "contain" as const,
    background: "transparent",
  };
  return (
    <label className="shop-field">
      <span className="shop-field__row">
        <span>Файл</span>
      </span>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,.jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.webm"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          onFile(file);
        }}
      />
      {previewUrl ? (
        previewKind === "video" ? (
          <video src={previewUrl} muted playsInline autoPlay loop style={previewStyle} />
        ) : (
          <img src={previewUrl} alt="Превью" style={previewStyle} />
        )
      ) : (
        <p className="muted">
          Превью до покупки. JPG, PNG, WebP, GIF, MP4, MOV, WebM · до 10 МБ · на
          стриме 7 секунд.
        </p>
      )}
    </label>
  );
}

function ShopField({
  field,
  productCode,
  value,
  onChange,
}: {
  field: ShopRequiredField;
  productCode: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const max = shopFieldMax(field);
  const placeholder = shopFieldPlaceholder(field, productCode);
  return (
    <label className="shop-field">
      <span className="shop-field__row">
        <span>{SHOP_SHEET_FIELD_LABEL[field]}</span>
        {max !== undefined ? (
          <span className="shop-field__count">
            {value.length}/{max}
          </span>
        ) : null}
      </span>
      {field === "donationText" ? (
        <textarea
          name={field}
          maxLength={max}
          rows={4}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          name={field}
          value={value}
          maxLength={max}
          {...(placeholder ? { placeholder } : {})}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

export function OrdersView({ items }: { items: ProfileOrder[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="shop-order-list">
      {items.map((order) => (
        <article key={order.id} className={`shop-order-card shop-order-card--${order.status}`}>
          <ShopProductArt code={order.productCode} title={order.productName} />
          <div className="shop-order-card__copy">
            <p className="shop-order-card__title">{order.productName}</p>
            <p className="shop-order-card__price">
              <CoinAmount amount={order.priceAzc} size={15} />
            </p>
            <p className="shop-order-card__meta">Заказ #{shortPublicId(order.id)}</p>
            <p className="shop-order-card__meta">{formatShortDateTime(order.createdAt)}</p>
            <p className={`shop-order-card__status shop-order-card__status--${order.status}`}>
              {order.status === "fulfilled" ? "Выполнен" : friendlyShopStatus(order.status)}
            </p>
            {Object.keys(order.submittedPreview).length > 0 ? (
              <div className="shop-order-card__details">
                {Object.entries(order.submittedPreview).map(([key, value]) => (
                  <p key={key}>
                    {shopPayloadDetailLabel(key)}: {value}
                  </p>
                ))}
              </div>
            ) : null}
            {order.rejectionReason ? <p className="shop-order-card__reason">{order.rejectionReason}</p> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

export function OrdersEmpty({ onShop }: { onShop: () => void }) {
  return (
    <div className="shop-orders-empty">
      <div className="shop-orders-empty__icon">
        <IconCart size={44} />
      </div>
      <p className="shop-orders-empty__title">У тебя пока нет заказов</p>
      <p className="muted">
        Когда ты что-нибудь приобретёшь в магазине, заказ появится здесь.
      </p>
      <button type="button" className="shop-orders-empty__cta" onClick={onShop}>
        Перейти в магазин
      </button>
    </div>
  );
}

function StreamOrderPreview({
  submissionId,
  skipRemote,
  adminToken,
}: {
  submissionId: string;
  skipRemote: boolean;
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
      .then((token) => loadAdminStreamGifBlob(token, submissionId))
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
  }, [submissionId, skipRemote, adminToken]);
  if (!src) {
    return (
      <p className="muted" data-preview-submission-id={submissionId}>
        превью медиа
      </p>
    );
  }
  return (
    <img
      src={src}
      alt=""
      data-preview-submission-id={submissionId}
      style={{
        width: 96,
        height: 72,
        objectFit: "contain",
        background: "transparent",
      }}
    />
  );
}

export function AdminShopOrdersView({
  items,
  status,
  reason,
  note,
  noteItemId,
  streamMedia,
  submitting = false,
  skipRemote = true,
  adminToken,
  onStatusChange,
  onReasonChange,
  onProcess,
  onFulfill,
  onApproveStream,
  onReject,
}: {
  items: Array<{
    id: string;
    user: string | null;
    productName: string;
    productCode: string;
    priceAzc: string;
    status: ShopOrderStatus;
    submittedPayload: Record<string, string>;
    createdAt: string;
    rejectionReason: string | null;
    fulfillmentType: "manual" | "instant";
  }>;
  status: ShopOrderStatus | "all";
  reason: string;
  note?: string;
  noteItemId?: string;
  streamMedia?: Record<string, StreamGifModerationSnapshot>;
  submitting?: boolean;
  skipRemote?: boolean;
  adminToken?: string;
  onStatusChange: (status: ShopOrderStatus | "all") => void;
  onReasonChange: (value: string) => void;
  onProcess: (id: string) => void;
  onFulfill: (id: string) => void;
  onApproveStream?: (binding: StreamOrderBinding) => void;
  onReject: (id: string) => void;
}) {
  const filters: Array<{ id: ShopOrderStatus | "all"; label: string }> = [
    { id: "all", label: "Все" },
    { id: "pending", label: "Ожидают" },
    { id: "processing", label: "В обработке" },
    { id: "fulfilled", label: "Готовы" },
    { id: "rejected", label: "Отклонены" },
  ];

  return (
    <div className="stack">
      <div className="seg-tabs" role="tablist">
        {filters.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={option.id === status}
            className={option.id === status ? "seg-tabs__item is-active" : "seg-tabs__item"}
            onClick={() => onStatusChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <label className="field">
        Причина отклонения
        <input value={reason} onChange={(event) => onReasonChange(event.target.value)} />
      </label>
      {note && !noteItemId ? <p className="muted">{note}</p> : null}
      {items.length === 0 ? (
        <p className="muted">Заказов нет.</p>
      ) : (
        items.map((item) => {
          const binding = streamOrderBinding(item);
          const isStreamMedia = binding !== null;
          const canAct =
            item.fulfillmentType !== "instant" &&
            (item.status === "pending" || item.status === "processing");
          const submission = binding
            ? streamMedia?.[binding.submissionId]
            : undefined;
          const playbackLabel = streamGifPlaybackLabel(submission?.status);
          const canApproveStream =
            Boolean(onApproveStream) &&
            canApproveStreamOrder({
              orderStatus: item.status,
              binding,
              ...(submission ? { submission } : {}),
            });
          return (
            <article
              key={item.id}
              className="card stack"
              data-order-id={item.id}
              {...(binding
                ? { "data-submission-id": binding.submissionId }
                : {})}
            >
              <p className="mini-row__title">{item.productName}</p>
              <p>{submission?.displayName ?? item.user ?? item.id}</p>
              {binding ? (
                <p className="muted">Заказ {binding.orderId.slice(0, 8)}</p>
              ) : null}
              {note && noteItemId === item.id ? (
                <p className="muted" data-order-note={item.id}>
                  {note}
                </p>
              ) : null}
              <p>
                <CoinAmount amount={item.priceAzc} />
              </p>
              <p>{friendlyShopStatus(item.status)}</p>
              {playbackLabel ? <p className="muted">{playbackLabel}</p> : null}
              <p className="muted">{new Date(item.createdAt).toLocaleString("ru-RU")}</p>
              {binding ? (
                <StreamOrderPreview
                  submissionId={binding.submissionId}
                  skipRemote={skipRemote}
                  {...(adminToken ? { adminToken } : {})}
                />
              ) : null}
              {isStreamMedia ? (
                <p className="muted">
                  Показ в OBS только после модерации. «Выполнено» очередь не ставит.
                </p>
              ) : null}
              {Object.keys(item.submittedPayload).length > 0 ? (
                <div className="shop-order-details">
                  {Object.entries(item.submittedPayload)
                    .filter(([key]) => key !== "gifUploadId")
                    .map(([key, value]) => (
                    <p key={key}>
                      {shopPayloadDetailLabel(key)}: {value}
                    </p>
                  ))}
                </div>
              ) : null}
              {item.rejectionReason ? <p className="muted">{item.rejectionReason}</p> : null}
              {canApproveStream && binding && onApproveStream ? (
                <div className="stack">
                  <a href="#/admin/stream-gifs">Открыть модерацию медиа</a>
                  <button
                    type="button"
                    disabled={submitting}
                    data-order-id={binding.orderId}
                    data-submission-id={binding.submissionId}
                    onClick={() => onApproveStream(binding)}
                  >
                    Одобрить и отправить на стрим
                  </button>
                </div>
              ) : null}
              {canAct && !isStreamMedia ? (
                <div className="stack">
                  {item.status === "pending" ? (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => onProcess(item.id)}
                    >
                      В обработку
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => onFulfill(item.id)}
                  >
                    Выполнено
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => onReject(item.id)}
                  >
                    Отклонить
                  </button>
                </div>
              ) : null}
              {canAct && isStreamMedia ? (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => onReject(item.id)}
                >
                  Отклонить
                </button>
              ) : null}
            </article>
          );
        })
      )}
    </div>
  );
}
