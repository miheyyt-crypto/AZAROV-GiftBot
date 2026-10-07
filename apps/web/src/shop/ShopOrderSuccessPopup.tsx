import { CloseButton } from "../components/CloseButton.js";
import { OverlayPortal } from "../components/OverlayPortal.js";
import { CoinAmount } from "../components/CoinAmount.js";
import { IconShopBag } from "../assets/icons.js";
import type { ShopCatalogProduct } from "./shop-messages.js";

export type ShopSuccessOrder = {
  orderId: string;
  productTitle: string;
  productCode?: string;
  priceAzc: string;
  fulfillmentType: ShopCatalogProduct["fulfillmentType"];
};

export function ShopOrderSuccessPopup({
  order,
  onClose,
  onOrders,
}: {
  order: ShopSuccessOrder;
  onClose: () => void;
  onOrders: () => void;
}) {
  const streamAlert = order.productCode === "donat";
  const processing = !streamAlert && order.fulfillmentType !== "instant";
  return (
    <OverlayPortal>
    <div className="gift-overlay gift-overlay--compact" role="presentation">
      <button
        type="button"
        className="gift-overlay__backdrop"
        aria-label="Закрыть"
        onClick={onClose}
      />
      <div
        className="gift-overlay__card shop-order-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shop-order-success-title"
        data-testid="shop-order-success"
      >
        <header className="shop-order-popup__head">
          <span className="shop-order-popup__mark" aria-hidden="true">
            <IconShopBag size={22} />
          </span>
          <CloseButton onClick={onClose} size="sheet" />
        </header>
        <h2 id="shop-order-success-title" className="shop-order-popup__title">
          Заказ создан
        </h2>
        <p className="shop-order-popup__lead">Ваш заказ успешно оформлен</p>
        <p className="shop-order-popup__sub">
          {streamAlert
            ? "Сообщение появится на стриме автоматически"
            : processing
              ? "Он уже передан в обработку"
              : "Streak Freeze добавлен в инвентарь"}
        </p>
        <div className="shop-order-popup__meta">
          <p className="shop-order-popup__product">{order.productTitle}</p>
          <CoinAmount amount={order.priceAzc} size={15} />
          {order.orderId ? (
            <p className="shop-order-popup__id">№ {order.orderId.slice(0, 8)}</p>
          ) : null}
        </div>
        <div className="shop-order-popup__actions">
          <button type="button" className="shop-order-popup__primary" onClick={onClose}>
            Понятно
          </button>
          <button type="button" className="shop-order-popup__ghost" onClick={onOrders}>
            Мои заказы
          </button>
        </div>
      </div>
    </div>
    </OverlayPortal>
  );
}
