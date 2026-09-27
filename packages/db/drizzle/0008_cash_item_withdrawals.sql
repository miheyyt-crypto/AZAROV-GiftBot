-- Forward-only RUB cash inventory withdrawal requests.
-- Manual admin Welvura payout only. No Wallet.apply. No case rewards.
-- Shop, Gram, games, and tasks are unchanged.

CREATE TYPE cash_item_withdrawal_status AS ENUM (
  'pending',
  'processing',
  'fulfilled',
  'rejected'
);

CREATE TABLE cash_item_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  inventory_item_id uuid NOT NULL REFERENCES inventory_items (id) ON DELETE RESTRICT,
  amount_rub bigint NOT NULL,
  welvura_id text NOT NULL,
  status cash_item_withdrawal_status NOT NULL DEFAULT 'pending',
  rejection_reason text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processing_at timestamptz,
  fulfilled_at timestamptz,
  rejected_at timestamptz,
  processed_by_admin_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT cash_item_withdrawals_amount_positive CHECK (amount_rub > 0)
);

CREATE UNIQUE INDEX cash_item_withdrawals_user_idempotency_unique
  ON cash_item_withdrawals (user_id, idempotency_key);

CREATE UNIQUE INDEX cash_item_withdrawals_one_active_per_item
  ON cash_item_withdrawals (inventory_item_id)
  WHERE status IN ('pending', 'processing');

CREATE INDEX cash_item_withdrawals_user_created_idx
  ON cash_item_withdrawals (user_id, created_at DESC, id DESC);

CREATE INDEX cash_item_withdrawals_status_created_idx
  ON cash_item_withdrawals (status, created_at DESC, id DESC);

CREATE INDEX cash_item_withdrawals_item_created_idx
  ON cash_item_withdrawals (inventory_item_id, created_at DESC, id DESC);
