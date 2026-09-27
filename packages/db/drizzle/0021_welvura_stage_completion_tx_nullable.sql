-- Expand: historical V1 cutover may record Welvura stage completions
-- without a new Wallet.apply credit (rewards already sit in opening balances).
-- Runtime approve still writes a transaction id when paying.
ALTER TABLE welvura_stage_completions
  ALTER COLUMN reward_transaction_id DROP NOT NULL;
