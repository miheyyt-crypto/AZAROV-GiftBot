-- Forward-only Gram withdrawal accounting.
-- amount_minor remains total Gram; reserved_minor is held by active requests.
-- No crypto payout. Shop and other mutation systems are unchanged.

ALTER TABLE gram_balances
  ADD COLUMN IF NOT EXISTS reserved_minor bigint NOT NULL DEFAULT 0;

ALTER TABLE gram_balances
  ADD CONSTRAINT gram_balances_reserved_non_negative CHECK (reserved_minor >= 0);

ALTER TABLE gram_balances
  ADD CONSTRAINT gram_balances_reserved_lte_balance CHECK (reserved_minor <= amount_minor);

CREATE TYPE gram_withdrawal_status AS ENUM (
  'pending',
  'processing',
  'fulfilled',
  'rejected'
);

CREATE TABLE gram_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL,
  telegram_username text NOT NULL,
  status gram_withdrawal_status NOT NULL DEFAULT 'pending',
  rejection_reason text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processing_at timestamptz,
  fulfilled_at timestamptz,
  rejected_at timestamptz,
  processed_by_admin_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT gram_withdrawals_amount_positive CHECK (amount_minor > 0)
);

CREATE UNIQUE INDEX gram_withdrawals_user_idempotency_unique
  ON gram_withdrawals (user_id, idempotency_key);

CREATE UNIQUE INDEX gram_withdrawals_one_active_per_user
  ON gram_withdrawals (user_id)
  WHERE status IN ('pending', 'processing');

CREATE INDEX gram_withdrawals_user_created_idx
  ON gram_withdrawals (user_id, created_at DESC, id DESC);

CREATE INDEX gram_withdrawals_status_created_idx
  ON gram_withdrawals (status, created_at DESC, id DESC);
