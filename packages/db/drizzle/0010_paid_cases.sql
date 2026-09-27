-- Paid cases: poor / medium / blatnoy openings + wallet ledger types.
-- Catalog weights live in domain PAID_CASE_CATALOG (product-decided).
-- Referral case is not included.

ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'paid_case_purchase';
ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'paid_case_reward';

CREATE TABLE paid_case_openings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  case_code text NOT NULL,
  price_azc bigint NOT NULL,
  item_code text NOT NULL,
  title_snapshot text NOT NULL,
  reward_type text NOT NULL,
  reward_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  real_weight bigint NOT NULL,
  real_chance text NOT NULL,
  display_chance text,
  rng_draw_id uuid REFERENCES rng_draws (id) ON DELETE RESTRICT,
  opened_at timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  purchase_transaction_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  reward_transaction_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  inventory_item_id uuid REFERENCES inventory_items (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT paid_case_openings_case_code_check CHECK (
    case_code IN ('poor', 'medium', 'blatnoy')
  ),
  CONSTRAINT paid_case_openings_price_positive CHECK (price_azc > 0),
  CONSTRAINT paid_case_openings_weight_positive CHECK (real_weight > 0),
  CONSTRAINT paid_case_openings_reward_type_check CHECK (
    reward_type IN ('azc', 'cash_rub')
  )
);

CREATE UNIQUE INDEX paid_case_openings_user_idempotency_unique
  ON paid_case_openings (user_id, idempotency_key);

CREATE INDEX paid_case_openings_user_opened_idx
  ON paid_case_openings (user_id, opened_at DESC, id DESC);

CREATE INDEX paid_case_openings_opened_idx
  ON paid_case_openings (opened_at DESC, id DESC);

CREATE INDEX paid_case_openings_case_opened_idx
  ON paid_case_openings (case_code, opened_at DESC, id DESC);
