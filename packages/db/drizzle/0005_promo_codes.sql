-- Forward-only promo codes. Credits still go through wallet_transactions / Wallet.apply.

ALTER TYPE wallet_transaction_type ADD VALUE 'promo_code_reward';

CREATE TYPE promo_code_status AS ENUM ('active', 'inactive');

CREATE TABLE promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  normalized_code text NOT NULL,
  reward_azc bigint NOT NULL,
  activation_limit integer NOT NULL,
  activation_count integer NOT NULL DEFAULT 0,
  status promo_code_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  CONSTRAINT promo_codes_normalized_code_unique UNIQUE (normalized_code),
  CONSTRAINT promo_codes_reward_positive CHECK (reward_azc > 0),
  CONSTRAINT promo_codes_activation_limit_positive CHECK (activation_limit > 0),
  CONSTRAINT promo_codes_activation_count_non_negative CHECK (activation_count >= 0),
  CONSTRAINT promo_codes_activation_count_within_limit CHECK (activation_count <= activation_limit)
);

CREATE INDEX promo_codes_created_at_idx
  ON promo_codes (created_at DESC, id DESC);
CREATE INDEX promo_codes_status_idx
  ON promo_codes (status);

CREATE TABLE promo_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id uuid NOT NULL REFERENCES promo_codes (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  reward_azc bigint NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promo_redemptions_promo_user_unique UNIQUE (promo_code_id, user_id),
  CONSTRAINT promo_redemptions_reward_positive CHECK (reward_azc > 0)
);

CREATE INDEX promo_redemptions_user_idx ON promo_redemptions (user_id);
CREATE INDEX promo_redemptions_promo_idx ON promo_redemptions (promo_code_id);
CREATE INDEX promo_redemptions_created_at_idx
  ON promo_redemptions (created_at DESC, id DESC);
