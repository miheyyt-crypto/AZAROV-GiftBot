-- Referral activation rewards + Referral Case entitlements/openings.
-- Activation: first successful Kick link. Referral Case: every 5 activated referrals.

ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'referral_inviter_reward';
ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'referral_referred_reward';
ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'referral_case_reward';

CREATE TABLE referral_case_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  milestone_number integer NOT NULL,
  referral_count_threshold integer NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_case_entitlements_milestone_positive CHECK (milestone_number > 0),
  CONSTRAINT referral_case_entitlements_threshold_positive CHECK (referral_count_threshold > 0),
  CONSTRAINT referral_case_entitlements_threshold_matches CHECK (
    referral_count_threshold = milestone_number * 5
  )
);

CREATE UNIQUE INDEX referral_case_entitlements_user_milestone_unique
  ON referral_case_entitlements (user_id, milestone_number);

CREATE INDEX referral_case_entitlements_user_available_idx
  ON referral_case_entitlements (user_id, granted_at)
  WHERE consumed_at IS NULL;

CREATE TABLE referral_case_openings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  case_code text NOT NULL DEFAULT 'referral',
  entitlement_id uuid NOT NULL REFERENCES referral_case_entitlements (id) ON DELETE RESTRICT,
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
  reward_transaction_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  inventory_item_id uuid REFERENCES inventory_items (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_case_openings_case_code_check CHECK (case_code = 'referral'),
  CONSTRAINT referral_case_openings_weight_positive CHECK (real_weight > 0),
  CONSTRAINT referral_case_openings_reward_type_check CHECK (
    reward_type IN ('azc', 'cash_rub')
  )
);

CREATE UNIQUE INDEX referral_case_openings_user_idempotency_unique
  ON referral_case_openings (user_id, idempotency_key);

CREATE UNIQUE INDEX referral_case_openings_entitlement_unique
  ON referral_case_openings (entitlement_id);

CREATE INDEX referral_case_openings_user_opened_idx
  ON referral_case_openings (user_id, opened_at DESC, id DESC);

CREATE INDEX referral_case_openings_opened_idx
  ON referral_case_openings (opened_at DESC, id DESC);

CREATE INDEX referrals_referrer_status_activated_idx
  ON referrals (referrer_user_id, status, activated_at);
