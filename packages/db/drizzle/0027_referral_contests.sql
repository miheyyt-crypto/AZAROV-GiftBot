ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'referral_contest_reward';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'referral_contest_status') THEN
    CREATE TYPE referral_contest_status AS ENUM ('scheduled', 'active', 'finalized');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS referral_contests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status referral_contest_status NOT NULL,
  title text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  prize_pool_azc bigint NOT NULL,
  prize_distribution jsonb NOT NULL,
  created_by_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finalized_at timestamptz,
  CONSTRAINT referral_contests_window CHECK (end_at > start_at),
  CONSTRAINT referral_contests_pool_positive CHECK (prize_pool_azc > 0),
  CONSTRAINT referral_contests_prize_places CHECK (jsonb_typeof(prize_distribution) = 'array' AND jsonb_array_length(prize_distribution) = 5)
);

CREATE UNIQUE INDEX IF NOT EXISTS referral_contests_singleton
  ON referral_contests ((1));

CREATE INDEX IF NOT EXISTS referral_contests_status_end_idx
  ON referral_contests (status, end_at);

CREATE TABLE IF NOT EXISTS referral_contest_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id uuid NOT NULL REFERENCES referral_contests (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  place integer NOT NULL,
  referral_count integer NOT NULL,
  score_reached_at timestamptz NOT NULL,
  reward_azc bigint NOT NULL DEFAULT 0,
  reward_transaction_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_contest_results_place_positive CHECK (place > 0),
  CONSTRAINT referral_contest_results_count_nonneg CHECK (referral_count >= 0),
  CONSTRAINT referral_contest_results_reward_nonneg CHECK (reward_azc >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS referral_contest_results_contest_user_unique
  ON referral_contest_results (contest_id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS referral_contest_results_contest_place_unique
  ON referral_contest_results (contest_id, place);

CREATE INDEX IF NOT EXISTS referral_contest_results_contest_place_idx
  ON referral_contest_results (contest_id, place);

CREATE INDEX IF NOT EXISTS referrals_contest_activated_idx
  ON referrals (referrer_user_id, activated_at)
  WHERE status = 'activated';
