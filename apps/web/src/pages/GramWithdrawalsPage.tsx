import { PageHeader } from "../components/PageHeader.js";
import { QueryPanel } from "../components/QueryPanel.js";
import { EmptyState } from "../components/EmptyState.js";
import { parseGramWithdrawals } from "../profile/parse.js";
import { GramWithdrawalHistoryView } from "../profile/GramWithdrawalHistoryView.js";
import { EMPTY_PROFILE_LIST } from "../profile/types.js";
import { useAuthedGet } from "../profile/useAuthedGet.js";

export function GramWithdrawalsPage({
  token,
  skipRemote = false,
}: {
  token: string;
  skipRemote?: boolean;
}) {
  const query = useAuthedGet(
    token,
    "/gram/withdrawals",
    parseGramWithdrawals,
    !skipRemote,
    EMPTY_PROFILE_LIST,
    false,
  );

  return (
    <div className="stack">
      <PageHeader title="Заявки на вывод Gram" backHref="#/profile" />
      <QueryPanel
        status={query.status}
        {...(query.status === "error" ? { errorMessage: query.message } : {})}
        onRetry={query.retry}
        loadingLabel="Загрузка заявок"
      >
        {query.status === "ready" && query.data.items.length === 0 ? (
          <EmptyState title="Пусто" text="Заявок пока нет." />
        ) : null}
        {query.status === "ready" && query.data.items.length > 0 ? (
          <GramWithdrawalHistoryView items={query.data.items} />
        ) : null}
      </QueryPanel>
    </div>
  );
}

export default GramWithdrawalsPage;
