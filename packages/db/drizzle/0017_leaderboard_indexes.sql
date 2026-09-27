-- Leaderboard TOP100 by current wallet balance (DESC) + tie-break via users join.
-- Supports efficient ORDER BY balance_minor DESC without inventing denormalized state.
CREATE INDEX IF NOT EXISTS wallets_balance_minor_desc_idx
  ON wallets (balance_minor DESC);
