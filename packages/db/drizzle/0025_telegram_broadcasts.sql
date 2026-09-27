-- Mass Telegram broadcasts. Jobs stay the delivery records; recipients track counters.
CREATE TYPE telegram_broadcast_status AS ENUM (
  'queued',
  'sending',
  'completed',
  'completed_with_errors',
  'failed'
);

CREATE TYPE telegram_broadcast_recipient_status AS ENUM (
  'pending',
  'sent',
  'failed'
);

CREATE TABLE telegram_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status telegram_broadcast_status NOT NULL DEFAULT 'queued',
  message_text text NOT NULL,
  photo_key text,
  parse_mode text NOT NULL DEFAULT 'HTML',
  button jsonb,
  recipient_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT telegram_broadcasts_counts_chk CHECK (
    recipient_count >= 0
    AND sent_count >= 0
    AND failed_count >= 0
    AND sent_count + failed_count <= recipient_count
  )
);

CREATE INDEX telegram_broadcasts_created_at_idx ON telegram_broadcasts (created_at);
CREATE INDEX telegram_broadcasts_status_idx ON telegram_broadcasts (status);

CREATE TABLE telegram_broadcast_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES telegram_broadcasts (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  telegram_user_id bigint NOT NULL,
  expected_jobs smallint NOT NULL DEFAULT 1,
  completed_jobs smallint NOT NULL DEFAULT 0,
  status telegram_broadcast_recipient_status NOT NULL DEFAULT 'pending',
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telegram_broadcast_recipients_jobs_chk CHECK (
    expected_jobs >= 1 AND completed_jobs >= 0 AND completed_jobs <= expected_jobs + 1
  )
);

CREATE UNIQUE INDEX telegram_broadcast_recipients_unique
  ON telegram_broadcast_recipients (broadcast_id, telegram_user_id);
CREATE INDEX telegram_broadcast_recipients_broadcast_status_idx
  ON telegram_broadcast_recipients (broadcast_id, status);

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS jobs_claim_priority_idx
  ON jobs (owner, status, priority, next_attempt_at, created_at);
