import { useEffect, useMemo, useState } from "react";
import { loadJson } from "../api.js";
import { IconFriends } from "../assets/icons.js";
import { Avatar } from "../components/Avatar.js";
import { BalanceBadge } from "../components/BalanceBadge.js";
import { CoinAmount } from "../components/CoinAmount.js";
import { PageHeader } from "../components/PageHeader.js";
import { QueryPanel } from "../components/QueryPanel.js";
import { SegmentedTabs } from "../components/SegmentedTabs.js";
import { useAzcBalance } from "../hooks/useAzcBalance.js";
import { groupDigits } from "../lib/format.js";
import {
  listAndPin,
  podiumSlots,
  type LeaderboardMetric,
  type LeaderboardRow,
} from "../leaderboard/leaderboard-ui.js";
import {
  leaderboardDisplayName,
  parseBalanceLeaderboard,
  parseReferralLeaderboard,
} from "../leaderboard/parse.js";
import {
  EMPTY_BALANCE_LEADERBOARD,
  EMPTY_REFERRAL_LEADERBOARD,
  type BalanceLeaderboardEntry,
  type BalanceLeaderboardResponse,
  type LeaderboardTab,
  type ReferralLeaderboardEntry,
  type ReferralLeaderboardResponse,
} from "../leaderboard/types.js";

function balanceRows(board: BalanceLeaderboardResponse): LeaderboardRow[] {
  return board.items.map((row) => ({
    place: row.rank,
    username: leaderboardDisplayName(row),
    valueLabel: groupDigits(row.balanceAzc),
    valueKind: "azc" as const,
    isYou: row.isYou,
    avatarUrl: row.avatarUrl,
  }));
}

function referralRows(board: ReferralLeaderboardResponse): LeaderboardRow[] {
  return board.items.map((row) => ({
    place: row.rank,
    username: leaderboardDisplayName(row),
    valueLabel: String(row.activeReferrals),
    valueKind: "friends" as const,
    isYou: row.isYou,
    avatarUrl: row.avatarUrl,
  }));
}

function selfRow(
  self: BalanceLeaderboardEntry | ReferralLeaderboardEntry | null,
  kind: LeaderboardMetric,
): LeaderboardRow | undefined {
  if (!self) {
    return undefined;
  }
  return {
    place: self.rank,
    username: leaderboardDisplayName(self),
    valueLabel:
      kind === "azc"
        ? groupDigits((self as BalanceLeaderboardEntry).balanceAzc)
        : String((self as ReferralLeaderboardEntry).activeReferrals),
    valueKind: kind,
    isYou: true,
    avatarUrl: self.avatarUrl,
  };
}

function Metric({
  row,
  size = 14,
}: {
  row: LeaderboardRow;
  size?: number;
}) {
  if (row.valueKind === "azc") {
    return <CoinAmount amount={row.valueLabel.replace(/\s/g, "")} size={size} />;
  }
  return (
    <span className="lb-friends">
      <IconFriends size={size} />
      <span>{row.valueLabel}</span>
    </span>
  );
}

function PodiumSlot({ row, place }: { row: LeaderboardRow | undefined; place: 1 | 2 | 3 }) {
  const avatarSize = place === 1 ? 68 : 52;
  return (
    <div className={`lb-podium__slot lb-podium__slot--${place}${row?.isYou ? " is-you" : ""}${row ? "" : " is-empty"}`}>
      <div className={`lb-podium__avatar lb-podium__avatar--${place}`}>
        {row ? (
          <Avatar name={row.username} src={row.avatarUrl} size={avatarSize} />
        ) : (
          <span className="avatar avatar--empty" aria-hidden="true">
            —
          </span>
        )}
        <span className={`lb-podium__badge lb-podium__badge--${place}`}>{place}</span>
      </div>
      <p className="lb-podium__name">{row ? row.username : "—"}</p>
      {row ? (
        <p className="lb-podium__metric">
          <Metric row={row} size={place === 1 ? 15 : 13} />
        </p>
      ) : (
        <p className="lb-podium__metric lb-podium__metric--empty">—</p>
      )}
      <div className={`lb-podium__block lb-podium__block--${place}`} aria-hidden="true">
        {place}
      </div>
    </div>
  );
}

function RankRowView({ row, pinned = false }: { row: LeaderboardRow; pinned?: boolean }) {
  return (
    <li className={pinned ? "lb-row is-you" : "lb-row"}>
      <span className="lb-rank">{row.place}</span>
      <Avatar name={row.username} src={row.avatarUrl} size={34} />
      <span className="lb-name">{row.isYou || pinned ? "Ты" : row.username}</span>
      <span className="lb-row__metric">
        <Metric row={row} size={14} />
      </span>
    </li>
  );
}

export function LeaderboardList({
  ranks,
  self,
}: {
  ranks: LeaderboardRow[];
  self: LeaderboardRow | undefined;
}) {
  const { first, second, third } = podiumSlots(ranks);
  const { rest, pin } = listAndPin(ranks, self);

  return (
    <div className="lb-board">
      <section className="lb-stage" aria-label="Топ-3">
        <div className="lb-podium">
          <PodiumSlot row={second} place={2} />
          <PodiumSlot row={first} place={1} />
          <PodiumSlot row={third} place={3} />
        </div>
      </section>

      {rest.length > 0 ? (
        <ul className="lb-list">
          {rest.map((row) => (
            <RankRowView key={`${row.place}-${row.username}`} row={row} />
          ))}
        </ul>
      ) : null}

      {pin ? (
        <ul className="lb-pin" data-testid="leaderboard-self-pinned">
          <RankRowView row={pin} pinned />
        </ul>
      ) : null}
    </div>
  );
}

export function BossesSoonCard() {
  return (
    <section className="lb-soon" aria-label="Боссов">
      <p className="lb-soon__title">СКОРО...</p>
    </section>
  );
}

export function LeaderboardPage({
  token,
  skipRemote = false,
  initialTab = "balance",
}: {
  token: string;
  skipRemote?: boolean;
  initialTab?: LeaderboardTab;
}) {
  const balanceAzc = useAzcBalance(token, skipRemote);
  const [tab, setTab] = useState<LeaderboardTab>(initialTab);
  const [balanceBoard, setBalanceBoard] = useState<BalanceLeaderboardResponse>(
    EMPTY_BALANCE_LEADERBOARD,
  );
  const [referralBoard, setReferralBoard] =
    useState<ReferralLeaderboardResponse>(EMPTY_REFERRAL_LEADERBOARD);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    skipRemote ? "ready" : "loading",
  );
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (tab === "boss" || skipRemote) {
      setStatus("ready");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setErrorMessage(undefined);
    if (tab === "balance") {
      void loadJson(token, "/leaderboard/balance", parseBalanceLeaderboard)
        .then((data) => {
          if (!cancelled) {
            setBalanceBoard(data);
            setStatus("ready");
          }
        })
        .catch(() => {
          if (!cancelled) {
            setStatus("error");
            setErrorMessage("Не удалось загрузить лидерборд");
          }
        });
    } else {
      void loadJson(token, "/leaderboard/referrals", parseReferralLeaderboard)
        .then((data) => {
          if (!cancelled) {
            setReferralBoard(data);
            setStatus("ready");
          }
        })
        .catch(() => {
          if (!cancelled) {
            setStatus("error");
            setErrorMessage("Не удалось загрузить лидерборд");
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [tab, token, skipRemote, nonce]);

  const balanceRanks = useMemo(() => balanceRows(balanceBoard), [balanceBoard]);
  const referralRanks = useMemo(() => referralRows(referralBoard), [referralBoard]);
  const balanceSelf = useMemo(
    () => selfRow(balanceBoard.self, "azc"),
    [balanceBoard.self],
  );
  const referralSelf = useMemo(
    () => selfRow(referralBoard.self, "friends"),
    [referralBoard.self],
  );

  return (
    <div className="stack leaderboard-page">
      <PageHeader
        title="Лидерборд"
        backHref="#/"
        align="start"
        trailing={<BalanceBadge amountAzcString={balanceAzc} />}
      />
      <div className="lb-tabs">
        <SegmentedTabs
          tone="purple"
          value={tab}
          options={[
            { id: "balance", label: "БАЛАНС" },
            { id: "referral", label: "РЕФЕРАЛ" },
            { id: "boss", label: "БОССОВ" },
          ]}
          onChange={setTab}
        />
      </div>
      {tab === "boss" ? (
        <BossesSoonCard />
      ) : (
        <QueryPanel
          status={
            status === "loading"
              ? "loading"
              : status === "error"
                ? "error"
                : "ready"
          }
          {...(status === "error" && errorMessage ? { errorMessage } : {})}
          onRetry={() => setNonce((value) => value + 1)}
          loadingLabel="Загрузка лидерборда"
        >
          {status === "ready" ? (
            tab === "balance" ? (
              <LeaderboardList ranks={balanceRanks} self={balanceSelf} />
            ) : (
              <LeaderboardList ranks={referralRanks} self={referralSelf} />
            )
          ) : null}
        </QueryPanel>
      )}
    </div>
  );
}

export default LeaderboardPage;
