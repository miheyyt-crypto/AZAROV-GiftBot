import { useState } from "react";
import { PageHeader } from "../components/PageHeader.js";
import { QueryPanel } from "../components/QueryPanel.js";
import { SegmentedTabs } from "../components/SegmentedTabs.js";
import { BalanceBadge } from "../components/BalanceBadge.js";
import { CashWithdrawalHistoryView } from "../profile/CashWithdrawalHistoryView.js";
import { parseCashWithdrawals } from "../profile/parse.js";
import { cashFilterMatch } from "../profile/profile-ui.js";
import { EMPTY_PROFILE_LIST } from "../profile/types.js";
import { useAuthedGet } from "../profile/useAuthedGet.js";
import { useAzcBalance } from "../hooks/useAzcBalance.js";
import type { CashItemWithdrawalStatus } from "../profile/types.js";

type Filter = "all" | CashItemWithdrawalStatus;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "pending", label: "Ожидает" },
  { id: "processing", label: "В обработке" },
  { id: "fulfilled", label: "Выполнено" },
  { id: "rejected", label: "Отклонено" },
];

export function CashWithdrawalsPage({
  token,
  skipRemote = false,
}: {
  token: string;
  skipRemote?: boolean;
}) {
  const balanceAzc = useAzcBalance(token, skipRemote);
  const [filter, setFilter] = useState<Filter>("all");
  const query = useAuthedGet(
    token,
    "/inventory/cash-withdrawals",
    parseCashWithdrawals,
    !skipRemote,
    EMPTY_PROFILE_LIST,
    false,
  );
  const items = query.status === "ready" ? query.data.items : [];
  const visible = items.filter((item) => cashFilterMatch(item.status, filter));

  return (
    <div className="stack ops-page">
      <PageHeader
        title="₽ заявки"
        backHref="#/profile/inventory"
        trailing={<BalanceBadge amountAzcString={balanceAzc} />}
      />
      <div className="h-scroll">
        <SegmentedTabs value={filter} options={FILTERS} onChange={setFilter} tone="purple" />
      </div>
      <QueryPanel
        status={query.status}
        {...(query.status === "error" ? { errorMessage: query.message } : {})}
        onRetry={query.retry}
        loadingLabel="Загрузка заявок"
      >
        {query.status === "ready" || skipRemote ? (
          <CashWithdrawalHistoryView items={query.status === "ready" ? visible : []} />
        ) : null}
      </QueryPanel>
    </div>
  );
}

export default CashWithdrawalsPage;
