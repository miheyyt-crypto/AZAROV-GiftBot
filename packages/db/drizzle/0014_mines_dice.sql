-- Mines + Dice + Provably Fair foundation.

ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'mines_bet';
ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'mines_win';
ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'dice_bet';
ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'dice_win';

CREATE TABLE provably_fair_nonces (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  game text NOT NULL,
  next_nonce bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game),
  CONSTRAINT provably_fair_nonces_game_check CHECK (game IN ('mines', 'dice')),
  CONSTRAINT provably_fair_nonces_next_non_negative CHECK (next_nonce >= 0)
);

CREATE TABLE mines_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status text NOT NULL,
  bet_azc bigint NOT NULL,
  mine_count integer NOT NULL,
  mine_positions integer[] NOT NULL,
  revealed_cells integer[] NOT NULL DEFAULT '{}',
  safe_pick_count integer NOT NULL DEFAULT 0,
  current_multiplier text,
  payout_azc bigint,
  client_seed text NOT NULL,
  server_seed text NOT NULL,
  server_seed_hash text NOT NULL,
  nonce bigint NOT NULL,
  algorithm text NOT NULL DEFAULT 'azarov:v1:mines',
  start_idempotency_key text NOT NULL,
  bet_transaction_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  win_transaction_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT mines_games_status_check CHECK (
    status IN ('active', 'cashed_out', 'lost', 'cleared')
  ),
  CONSTRAINT mines_games_bet_check CHECK (bet_azc >= 100 AND bet_azc <= 10000),
  CONSTRAINT mines_games_mine_count_check CHECK (
    mine_count IN (3, 5, 7, 10, 15, 20, 24)
  ),
  CONSTRAINT mines_games_safe_pick_check CHECK (safe_pick_count >= 0),
  CONSTRAINT mines_games_payout_non_negative CHECK (
    payout_azc IS NULL OR payout_azc >= 0
  )
);

CREATE UNIQUE INDEX mines_games_one_active_per_user
  ON mines_games (user_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX mines_games_start_idempotency_unique
  ON mines_games (user_id, start_idempotency_key);

CREATE INDEX mines_games_user_created_idx
  ON mines_games (user_id, created_at DESC, id DESC);

CREATE TABLE dice_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  bet_azc bigint NOT NULL,
  chance integer NOT NULL,
  raw_result integer NOT NULL,
  win boolean NOT NULL,
  payout_azc bigint NOT NULL,
  client_seed text NOT NULL,
  server_seed text NOT NULL,
  server_seed_hash text NOT NULL,
  nonce bigint NOT NULL,
  algorithm text NOT NULL DEFAULT 'azarov:v1:dice',
  play_idempotency_key text NOT NULL,
  bet_transaction_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  win_transaction_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dice_rounds_bet_check CHECK (bet_azc >= 100 AND bet_azc <= 10000),
  CONSTRAINT dice_rounds_chance_check CHECK (chance >= 1 AND chance <= 95),
  CONSTRAINT dice_rounds_raw_result_check CHECK (
    raw_result >= 0 AND raw_result <= 999999
  ),
  CONSTRAINT dice_rounds_payout_non_negative CHECK (payout_azc >= 0)
);

CREATE UNIQUE INDEX dice_rounds_play_idempotency_unique
  ON dice_rounds (user_id, play_idempotency_key);

CREATE INDEX dice_rounds_user_created_idx
  ON dice_rounds (user_id, created_at DESC, id DESC);

CREATE INDEX dice_rounds_wins_created_idx
  ON dice_rounds (created_at DESC, id DESC)
  WHERE win = true;

CREATE INDEX mines_games_wins_resolved_idx
  ON mines_games (resolved_at DESC, id DESC)
  WHERE status IN ('cashed_out', 'cleared') AND payout_azc IS NOT NULL AND payout_azc > 0;
