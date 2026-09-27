-- Rolls multiplayer weighted pool.

ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'rolls_bet';
ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'rolls_win';

ALTER TABLE provably_fair_nonces DROP CONSTRAINT IF EXISTS provably_fair_nonces_game_check;
ALTER TABLE provably_fair_nonces ADD CONSTRAINT provably_fair_nonces_game_check
  CHECK (game IN ('mines', 'dice', 'rolls'));

CREATE TABLE rolls_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  participant_count integer NOT NULL DEFAULT 0,
  total_pot bigint NOT NULL DEFAULT 0,
  betting_started_at timestamptz,
  betting_deadline timestamptz,
  locked_at timestamptz,
  spin_started_at timestamptz,
  spin_duration_ms integer NOT NULL DEFAULT 10000,
  resolved_at timestamptz,
  server_seed text NOT NULL,
  server_seed_hash text NOT NULL,
  nonce bigint NOT NULL,
  algorithm text NOT NULL DEFAULT 'azarov:v1:rolls',
  aggregate_client_seed text,
  participant_snapshot_hash text,
  participant_snapshot jsonb,
  winning_ticket bigint,
  winner_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  winner_participant_id uuid,
  payout_azc bigint,
  win_transaction_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rolls_rounds_status_check CHECK (
    status IN ('waiting', 'betting', 'spinning', 'resolved')
  ),
  CONSTRAINT rolls_rounds_pot_non_negative CHECK (total_pot >= 0),
  CONSTRAINT rolls_rounds_participants_non_negative CHECK (participant_count >= 0),
  CONSTRAINT rolls_rounds_version_positive CHECK (version >= 1)
);

-- At most one non-terminal round.
CREATE UNIQUE INDEX rolls_rounds_one_current
  ON rolls_rounds ((true))
  WHERE status IN ('waiting', 'betting', 'spinning');

CREATE INDEX rolls_rounds_status_created_idx
  ON rolls_rounds (status, created_at DESC);

CREATE TABLE rolls_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES rolls_rounds (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  public_id text NOT NULL,
  display_name text NOT NULL,
  avatar_key text,
  total_stake bigint NOT NULL,
  client_seed text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rolls_participants_stake_positive CHECK (total_stake > 0),
  CONSTRAINT rolls_participants_stake_max CHECK (total_stake <= 100000)
);

CREATE UNIQUE INDEX rolls_participants_round_user_unique
  ON rolls_participants (round_id, user_id);

CREATE INDEX rolls_participants_round_joined_idx
  ON rolls_participants (round_id, joined_at ASC, id ASC);

CREATE TABLE rolls_bet_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES rolls_rounds (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  participant_id uuid NOT NULL REFERENCES rolls_participants (id) ON DELETE RESTRICT,
  amount_azc bigint NOT NULL,
  stake_after bigint NOT NULL,
  idempotency_key text NOT NULL,
  bet_transaction_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rolls_bet_operations_amount_positive CHECK (amount_azc > 0)
);

CREATE UNIQUE INDEX rolls_bet_operations_user_key_unique
  ON rolls_bet_operations (user_id, idempotency_key);

CREATE INDEX rolls_bet_operations_round_created_idx
  ON rolls_bet_operations (round_id, created_at DESC);

CREATE INDEX rolls_rounds_wins_resolved_idx
  ON rolls_rounds (resolved_at DESC, id DESC)
  WHERE status = 'resolved' AND payout_azc IS NOT NULL AND payout_azc > 0;
