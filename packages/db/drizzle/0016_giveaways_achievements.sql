-- Giveaways expansion + Achievements

ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'giveaway_reward';
ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'achievement_reward';

ALTER TABLE giveaways
  ADD COLUMN IF NOT EXISTS type text,
  ADD COLUMN IF NOT EXISTS bank_azc bigint,
  ADD COLUMN IF NOT EXISTS custom_prize text,
  ADD COLUMN IF NOT EXISTS winner_count integer,
  ADD COLUMN IF NOT EXISTS actual_winner_count integer,
  ADD COLUMN IF NOT EXISTS eligibility text NOT NULL DEFAULT 'linked_kick',
  ADD COLUMN IF NOT EXISTS prize_per_winner_azc bigint,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS drawn_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill defaults for any legacy rows so NOT NULL constraints can apply.
UPDATE giveaways
SET
  type = COALESCE(type, 'coins'),
  winner_count = COALESCE(winner_count, 1),
  eligibility = COALESCE(eligibility, 'linked_kick')
WHERE type IS NULL OR winner_count IS NULL;

ALTER TABLE giveaways
  ALTER COLUMN type SET NOT NULL,
  ALTER COLUMN winner_count SET NOT NULL;

ALTER TABLE giveaways DROP CONSTRAINT IF EXISTS giveaways_type_check;
ALTER TABLE giveaways ADD CONSTRAINT giveaways_type_check
  CHECK (type IN ('coins', 'custom_prize'));

ALTER TABLE giveaways DROP CONSTRAINT IF EXISTS giveaways_eligibility_check;
ALTER TABLE giveaways ADD CONSTRAINT giveaways_eligibility_check
  CHECK (eligibility = 'linked_kick');

ALTER TABLE giveaways DROP CONSTRAINT IF EXISTS giveaways_winner_count_positive;
ALTER TABLE giveaways ADD CONSTRAINT giveaways_winner_count_positive
  CHECK (winner_count > 0);

ALTER TABLE giveaways DROP CONSTRAINT IF EXISTS giveaways_coins_bank_check;
ALTER TABLE giveaways ADD CONSTRAINT giveaways_coins_bank_check
  CHECK (
    (type = 'coins' AND bank_azc IS NOT NULL AND bank_azc > 0
      AND prize_per_winner_azc IS NOT NULL AND prize_per_winner_azc > 0
      AND custom_prize IS NULL)
    OR
    (type = 'custom_prize' AND custom_prize IS NOT NULL
      AND length(trim(custom_prize)) > 0
      AND bank_azc IS NULL AND prize_per_winner_azc IS NULL)
  );

CREATE INDEX IF NOT EXISTS giveaways_status_ends_idx
  ON giveaways (status, ends_at);

ALTER TABLE giveaway_winners
  ADD COLUMN IF NOT EXISTS prize_azc bigint,
  ADD COLUMN IF NOT EXISTS prize_text text,
  ADD COLUMN IF NOT EXISTS delivery_status text,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reward_transaction_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT;

ALTER TABLE giveaway_winners DROP CONSTRAINT IF EXISTS giveaway_winners_delivery_status_check;
ALTER TABLE giveaway_winners ADD CONSTRAINT giveaway_winners_delivery_status_check
  CHECK (
    delivery_status IS NULL
    OR delivery_status IN ('pending_delivery', 'delivered')
  );

CREATE UNIQUE INDEX IF NOT EXISTS giveaway_winners_giveaway_user_unique
  ON giveaway_winners (giveaway_id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS giveaway_winners_giveaway_entry_unique
  ON giveaway_winners (giveaway_id, entry_id);

CREATE TABLE IF NOT EXISTS user_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  achievement_code text NOT NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  reward_azc bigint NOT NULL,
  progress_snapshot jsonb,
  reward_transaction_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_achievements_reward_positive CHECK (reward_azc > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_achievements_user_code_unique
  ON user_achievements (user_id, achievement_code);

CREATE INDEX IF NOT EXISTS user_achievements_user_unlocked_idx
  ON user_achievements (user_id, unlocked_at DESC);
