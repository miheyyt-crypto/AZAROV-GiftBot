import { useState } from "react";
import { BottomSheet } from "../components/BottomSheet.js";
import { QueryPanel } from "../components/QueryPanel.js";
import { EmptyState } from "../components/EmptyState.js";
import { CoinAmount } from "../components/CoinAmount.js";
import { SegmentedTabs } from "../components/SegmentedTabs.js";
import { navigate } from "../app/routes.js";
import { formatShortDateTime, ledgerDeltaKind } from "../lib/format.js";
import { parseProfileLedger } from "../profile/parse.js";
import { EMPTY_PROFILE_LIST } from "../profile/types.js";
import type { ProfileLedgerEntry } from "../profile/types.js";
import { useAuthedGet } from "../profile/useAuthedGet.js";

type Filter = "all" | "in" | "out";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "in", label: "Приход" },
  { id: "out", label: "Расход" },
];

export function CoinHistoryList({
  items,
  filter,
}: {
  items: ProfileLedgerEntry[];
  filter: Filter;
}) {
  const visible = items.filter((row) => {
    const kind = ledgerDeltaKind(row.delta);
    if (filter === "all") {
      return true;
    }
    return kind === filter;
  });
  if (visible.length === 0) {
    return <EmptyState title="Пусто" text="Операций пока нет." />;
  }
  return (
    <>
      {visible.map((row) => {
        const kind = ledgerDeltaKind(row.delta);
        return (
          <article key={row.id} className={`coin-hist-card coin-hist-card--${kind}`}>
            <div className="coin-hist-card__row">
              <p className="coin-hist-card__label">{row.label}</p>
              <p className={`coin-hist-card__amt coin-hist-card__amt--${kind}`}>
                <CoinAmount amount={row.delta} sign="auto" size={15} />
              </p>
            </div>
            <p className="coin-hist-card__time">{formatShortDateTime(row.createdAt)}</p>
          </article>
        );
      })}
    </>
  );
}

export function CoinHistoryPage({
  token,
  skipRemote = false,
}: {
  token: string;
  skipRemote?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
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
    <BottomSheet
      open
      title="История монет"
      className="sheet--profile"
      onClose={() => navigate("#/profile")}
    >
      <QueryPanel
        status={query.status}
        {...(query.status === "error" ? { errorMessage: query.message } : {})}
        onRetry={query.retry}
        loadingLabel="Загрузка истории"
      >
        {query.status === "ready" ? (
          <div className="stack psheet-stack">
            <SegmentedTabs value={filter} options={FILTERS} onChange={setFilter} tone="purple" />
            <CoinHistoryList items={items} filter={filter} />
          </div>
        ) : null}
      </QueryPanel>
    </BottomSheet>
  );
}

export default CoinHistoryPage;
