ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'stream_donation';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stream_donation_status') THEN
    CREATE TYPE stream_donation_status AS ENUM ('queued', 'playing', 'finished');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS stream_donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  telegram_user_id bigint NOT NULL,
  display_name text NOT NULL,
  message text NOT NULL,
  amount_azc bigint NOT NULL,
  status stream_donation_status NOT NULL DEFAULT 'queued',
  client_request_id text NOT NULL,
  wallet_transaction_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  overlay_session_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  CONSTRAINT stream_donations_amount_positive CHECK (amount_azc > 0),
  CONSTRAINT stream_donations_message_nonempty CHECK (char_length(message) > 0),
  CONSTRAINT stream_donations_message_max CHECK (char_length(message) <= 200)
);

CREATE UNIQUE INDEX IF NOT EXISTS stream_donations_user_client_request_unique
  ON stream_donations (user_id, client_request_id);

CREATE INDEX IF NOT EXISTS stream_donations_status_created_idx
  ON stream_donations (status, created_at);

CREATE INDEX IF NOT EXISTS stream_donations_created_idx
  ON stream_donations (created_at DESC);

CREATE TABLE IF NOT EXISTS stream_alert_consumers (
  id integer PRIMARY KEY,
  session_id uuid NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  CONSTRAINT stream_alert_consumers_singleton CHECK (id = 1)
);
