export const PENDING_FLAG = "FLAG_OFF" as const;

export type PendingFlag = {
  id: number;
  decision: string;
  flag: typeof PENDING_FLAG;
  goLive: string;
};

/**
 * Phase 16 does not invent product values. Every still-pending row is
 * flagged off: dependent features stay disabled or catalog-empty.
 * Decision #9 (session TTL / auth_date) is product-decided and removed.
 */
export const PENDING_GO_LIVE_FLAGS: readonly PendingFlag[] = [
  {
    id: 2,
    decision: "What counts as proven Kick watch / presence",
    flag: PENDING_FLAG,
    goLive: "Kick apply does not treat chat/presence as watch-time or pay",
  },
  {
    id: 3,
    decision: "Concrete game rules",
    flag: PENDING_FLAG,
    goLive: "play requires a catalog row; none are seeded",
  },
  {
    id: 4,
    decision: "Reward sizes / economy amounts",
    flag: PENDING_FLAG,
    goLive: "no invented reward amounts",
  },
  {
    id: 6,
    decision: "Giveaway rules",
    flag: PENDING_FLAG,
    goLive: "giveaway settle stays unused without product rules",
  },
  {
    id: 10,
    decision: "Exact notification rules",
    flag: PENDING_FLAG,
    goLive: "no invented notification policy",
  },
  {
    id: 11,
    decision: "Admin roles besides super_admin",
    flag: PENDING_FLAG,
    goLive: "only super_admin exists; no extra roles seeded",
  },
  {
    id: 12,
    decision: "Currency code and minor-unit scale",
    flag: PENDING_FLAG,
    goLive: "BIGINT ledger stands; denomination is not chosen",
  },
  {
    id: 13,
    decision: "Whether provably-fair commit-reveal is required",
    flag: PENDING_FLAG,
    goLive: "CSPRNG audit exists; commit-reveal is not required",
  },
  {
    id: 14,
    decision: "Repeatable tasks / periods",
    flag: PENDING_FLAG,
    goLive: "completions stay one-shot (task, user)",
  },
];

export function assertAllPendingFlaggedOff(): void {
  if (PENDING_GO_LIVE_FLAGS.length !== 9) {
    throw new Error("remaining pending product decisions must stay flagged off");
  }
  for (const row of PENDING_GO_LIVE_FLAGS) {
    if (row.flag !== PENDING_FLAG) {
      throw new Error(`pending #${String(row.id)} was treated as decided`);
    }
    if (
      row.id === 1 ||
      row.id === 5 ||
      row.id === 7 ||
      row.id === 8 ||
      row.id === 9
    ) {
      throw new Error(
        "referral activation (#1), shop prices (#5), tasks/welvura (#7), case odds (#8), and session TTL (#9) were product-decided and must not stay pending",
      );
    }
  }
}
