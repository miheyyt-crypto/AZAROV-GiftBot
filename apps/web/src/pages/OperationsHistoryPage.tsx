import { useState } from "react";
import { PageHeader } from "../components/PageHeader.js";
import { QueryPanel } from "../components/QueryPanel.js";
import { SegmentedTabs } from "../components/SegmentedTabs.js";
import { BalanceBadge } from "../components/BalanceBadge.js";
import { CoinAmount } from "../components/CoinAmount.js";
import { EmptyState } from "../components/EmptyState.js";
import { parseProfileLedger } from "../profile/parse.js";
import {
  operationTabMatch,
  operationTone,
  type OperationTab,
} from "../profile/profile-ui.js";
import { EMPTY_PROFILE_LIST } from "../profile/types.js";
import type { ProfileLedgerEntry } from "../profile/types.js";
import { useAuthedGet } from "../profile/useAuthedGet.js";
import { useAzcBalance } from "../hooks/useAzcBalance.js";
import { formatShortDate, ledgerDeltaKind } from "../lib/format.js";

const FILTERS: { id: OperationTab; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "in", label: "Приход" },
  { id: "purchase", label: "Покупки" },
  { id: "reward", label: "Награды" },
];

function OpsGlyph({ tone }: { tone: ReturnType<typeof operationTone> }) {
  if (tone === "purchase") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M7 9h10v10.2A1.8 1.8 0 0 1 15.2 21H8.8A1.8 1.8 0 0 1 7 19.2V9Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M9.4 9V7.2a2.6 2.6 0 0 1 5.2 0V9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (tone === "reward") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 5v14M8 9l4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tone === "bet") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4.5" y="7" width="15" height="10" rx="2.4" stroke="currentColor" strokeWidth="1.8" />
        <path d="M9 12h2M14.8 11.2h.2M16.4 12.8h.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 4.6h10v15.2l-2.2-1.3-2.8 1.6-2.8-1.6L7 19.8V4.6Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function OperationsHistoryList({
  items,
  tab,
}: {
  items: ProfileLedgerEntry[];
  tab: OperationTab;
}) {
  const visible = items.filter((row) => operationTabMatch(row, tab));
  if (visible.length === 0) {
    return <EmptyState title="Пусто" text="Операций пока нет." />;
  }
  return (
    <div className="stack ops-list">
      {visible.map((row) => {
        const kind = ledgerDeltaKind(row.delta);
        const tone = operationTone(row.type);
        return (
          <article key={row.id} className={`ops-card ops-card--${kind}`} data-type={row.type}>
            <span className={`ops-card__tile ops-card__tile--${tone}`}>
              <OpsGlyph tone={tone} />
            </span>
            <div className="ops-card__copy">
              <div className="ops-card__row">
                <p className={`ops-card__amount coin-hist-card__amt--${kind}`}>
                  <CoinAmount amount={row.delta} sign="auto" size={16} />
                </p>
                <p className="ops-card__date">{formatShortDate(row.createdAt)}</p>
              </div>
              <p className="ops-card__label">{row.label}</p>
              {row.balanceAfter ? (
                <p className="ops-card__balance">
                  Баланс: <CoinAmount amount={row.balanceAfter} size={13} />
                </p>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function OperationsHistoryPage({
  token,
  skipRemote = false,
}: {
  token: string;
  skipRemote?: boolean;
}) {
  const balanceAzc = useAzcBalance(token, skipRemote);
  const [tab, setTab] = useState<OperationTab>("all");
  const query = useAuthedGet(
    token,
    "/profile/ledger",
    parseProfileLedger,
    !skipRemote,
    EMPTY_PROFILE_LIST,
    false,
  );
  const items = query.status === "ready" ? query.data.items : [];

  return (
    <div className="stack ops-page">
      <PageHeader
        title="История операций"
        backHref="#/profile"
        trailing={<BalanceBadge amountAzcString={balanceAzc} />}
      />
      <div className="h-scroll">
        <SegmentedTabs value={tab} options={FILTERS} onChange={setTab} tone="purple" />
      </div>
      <QueryPanel
        status={query.status}
        {...(query.status === "error" ? { errorMessage: query.message } : {})}
        onRetry={query.retry}
        loadingLabel="Загрузка операций"
      >
        {query.status === "ready" ? <OperationsHistoryList items={items} tab={tab} /> : null}
      </QueryPanel>
    </div>
  );
}

export default OperationsHistoryPage;
