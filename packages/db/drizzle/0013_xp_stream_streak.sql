-- XP / Levels / Stream Streak / Kick chat applications.
-- Level definitions stay in domain code; DB stores grants, sessions, participation.

ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'level_reward';
ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'stream_streak_reward';

CREATE TABLE kick_stream_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL,
  provider_stream_id text,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  finalization_status text NOT NULL DEFAULT 'none',
  finalization_cursor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kick_stream_sessions_status_check CHECK (
    status IN ('live', 'ended')
  ),
  CONSTRAINT kick_stream_sessions_finalization_check CHECK (
    finalization_status IN ('none', 'pending', 'running', 'completed')
  )
);

CREATE UNIQUE INDEX kick_stream_sessions_one_live_per_channel
  ON kick_stream_sessions (channel)
  WHERE status = 'live';

CREATE UNIQUE INDEX kick_stream_sessions_provider_stream_unique
  ON kick_stream_sessions (provider_stream_id)
  WHERE provider_stream_id IS NOT NULL;

CREATE INDEX kick_stream_sessions_channel_started_idx
  ON kick_stream_sessions (channel, started_at DESC);

CREATE TABLE kick_chat_message_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_message_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  stream_session_id uuid NOT NULL REFERENCES kick_stream_sessions (id) ON DELETE RESTRICT,
  inbound_event_id uuid REFERENCES inbound_events (id) ON DELETE SET NULL,
  xp_awarded integer NOT NULL DEFAULT 1,
  applied_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kick_chat_message_applications_xp_check CHECK (xp_awarded = 1)
);

CREATE UNIQUE INDEX kick_chat_message_applications_provider_unique
  ON kick_chat_message_applications (provider_message_id);

CREATE INDEX kick_chat_message_applications_user_applied_idx
  ON kick_chat_message_applications (user_id, applied_at DESC);

CREATE TABLE user_stream_participation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  stream_session_id uuid NOT NULL REFERENCES kick_stream_sessions (id) ON DELETE RESTRICT,
  message_count integer NOT NULL DEFAULT 0,
  qualified_at timestamptz,
  finalized_at timestamptz,
  streak_action text,
  reward_azc bigint,
  freeze_inventory_item_id uuid REFERENCES inventory_items (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_stream_participation_message_count_check CHECK (message_count >= 0),
  CONSTRAINT user_stream_participation_action_check CHECK (
    streak_action IS NULL
    OR streak_action IN (
      'qualified',
      'rewarded',
      'freeze_consumed',
      'reset',
      'noop_completed',
      'noop_zero_streak'
    )
  )
);

CREATE UNIQUE INDEX user_stream_participation_user_stream_unique
  ON user_stream_participation (user_id, stream_session_id);

CREATE INDEX user_stream_participation_stream_idx
  ON user_stream_participation (stream_session_id);

CREATE TABLE user_stream_streaks (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE RESTRICT,
  current_streak integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  last_qualified_stream_id uuid REFERENCES kick_stream_sessions (id) ON DELETE RESTRICT,
  last_finalized_stream_id uuid REFERENCES kick_stream_sessions (id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_stream_streaks_range_check CHECK (
    current_streak >= 0 AND current_streak <= 10
  )
);

CREATE TABLE user_level_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  reached_level integer NOT NULL,
  reward_azc bigint NOT NULL,
  reward_transaction_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_level_rewards_level_check CHECK (
    reached_level >= 2 AND reached_level <= 50
  ),
  CONSTRAINT user_level_rewards_reward_positive CHECK (reward_azc > 0)
);

CREATE UNIQUE INDEX user_level_rewards_user_level_unique
  ON user_level_rewards (user_id, reached_level);
