-- Manual / ghost referral credits. Do not create fake referrals or users.

ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'referral_manual_credit';

CREATE TABLE IF NOT EXISTS manual_referral_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  amount integer NOT NULL,
  reason text,
  idempotency_key text NOT NULL,
  created_by_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  reward_transaction_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT manual_referral_credits_amount_positive CHECK (amount > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS manual_referral_credits_idempotency_key_unique
  ON manual_referral_credits (idempotency_key);

CREATE INDEX IF NOT EXISTS manual_referral_credits_user_id_idx
  ON manual_referral_credits (user_id);
