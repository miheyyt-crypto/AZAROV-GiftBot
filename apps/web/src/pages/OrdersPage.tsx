import { useState } from "react";
import { navigate } from "../app/routes.js";
import { PageHeader } from "../components/PageHeader.js";
import { SegmentedTabs } from "../components/SegmentedTabs.js";
import { QueryPanel } from "../components/QueryPanel.js";
import { BalanceBadge } from "../components/BalanceBadge.js";
import { parseProfileOrders } from "../profile/parse.js";
import { EMPTY_PROFILE_LIST } from "../profile/types.js";
import type { ProfileOrder } from "../profile/types.js";
import { useAuthedGet } from "../profile/useAuthedGet.js";
import { useAzcBalance } from "../hooks/useAzcBalance.js";
import { OrdersEmpty, OrdersView } from "../shop/ShopView.js";

type Filter = "all" | ProfileOrder["status"];

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "pending", label: "В ожидании" },
  { id: "processing", label: "В обработке" },
  { id: "fulfilled", label: "Готовы" },
  { id: "rejected", label: "Отклонены" },
];

export function OrdersPage({
  token,
  skipRemote = false,
}: {
  token: string;
  skipRemote?: boolean;
}) {
  const balanceAzc = useAzcBalance(token, skipRemote);
  const [filter, setFilter] = useState<Filter>("all");
  const path = filter === "all" ? "/profile/orders" : `/profile/orders?status=${filter}`;
  const query = useAuthedGet(
    token,
    path,
    parseProfileOrders,
    !skipRemote,
    EMPTY_PROFILE_LIST,
    false,
  );

  return (
    <div className="stack shop-orders-page">
      <PageHeader
        title="Мои заказы"
        backHref="#/shop"
        trailing={<BalanceBadge amountAzcString={balanceAzc} />}
      />
      <div className="h-scroll">
        <SegmentedTabs value={filter} options={FILTERS} onChange={setFilter} />
      </div>
      <QueryPanel
        status={query.status}
        {...(query.status === "error" ? { errorMessage: query.message } : {})}
        onRetry={query.retry}
        loadingLabel="Загрузка заказов"
      >
        {query.status === "ready" && query.data.items.length === 0 ? (
          <OrdersEmpty onShop={() => navigate("#/shop")} />
        ) : null}
        {query.status === "ready" ? <OrdersView items={query.data.items} /> : null}
      </QueryPanel>
    </div>
  );
}

export default OrdersPage;
