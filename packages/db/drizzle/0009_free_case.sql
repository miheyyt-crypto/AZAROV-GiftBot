-- Forward-only Free Case openings, cooldown state, and external_prize inventory.
-- Paid cases, referral case, games, tasks unchanged.
-- Free Case odds are product-decided in domain FREE_CASE_CATALOG (not invented paid RTP).

ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'free_case_reward';

ALTER TYPE inventory_item_type ADD VALUE IF NOT EXISTS 'external_prize';

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS item_code text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE inventory_items
  DROP CONSTRAINT IF EXISTS inventory_items_cash_amount;

ALTER TABLE inventory_items
  ADD CONSTRAINT inventory_items_cash_amount CHECK (
    (
      item_type = 'cash_rub'
      AND amount_rub IS NOT NULL
      AND amount_rub >= 0
    )
    OR (
      item_type = 'streak_freeze'
      AND amount_rub IS NULL
    )
    OR (
      -- Compare via text so this migration can commit after ADD VALUE
      -- (PG forbids using a brand-new enum label in the same transaction).
      item_type::text = 'external_prize'
      AND amount_rub IS NULL
    )
  );

CREATE TABLE free_case_user_state (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE RESTRICT,
  next_available_at timestamptz NOT NULL DEFAULT TIMESTAMPTZ 'epoch',
  last_opening_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE free_case_openings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  case_code text NOT NULL DEFAULT 'free',
  item_code text NOT NULL,
  title_snapshot text NOT NULL,
  rarity text NOT NULL,
  reward_type text NOT NULL,
  reward_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  real_weight bigint NOT NULL,
  display_chance text NOT NULL,
  real_chance text NOT NULL,
  rng_draw_id uuid REFERENCES rng_draws (id) ON DELETE RESTRICT,
  opened_at timestamptz NOT NULL,
  next_available_at timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  wallet_transaction_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  inventory_item_id uuid REFERENCES inventory_items (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT free_case_openings_case_code_free CHECK (case_code = 'free'),
  CONSTRAINT free_case_openings_weight_positive CHECK (real_weight > 0)
);

CREATE UNIQUE INDEX free_case_openings_user_idempotency_unique
  ON free_case_openings (user_id, idempotency_key);

CREATE INDEX free_case_openings_user_opened_idx
  ON free_case_openings (user_id, opened_at DESC, id DESC);

CREATE INDEX free_case_openings_opened_idx
  ON free_case_openings (opened_at DESC, id DESC);

ALTER TABLE free_case_user_state
  ADD CONSTRAINT free_case_user_state_last_opening_fk
  FOREIGN KEY (last_opening_id) REFERENCES free_case_openings (id) ON DELETE RESTRICT;
