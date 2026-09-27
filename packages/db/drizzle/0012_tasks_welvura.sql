-- Tasks (code-catalog claims) + Welvura moderation chain + submission files.
-- Task definitions live in domain code; DB stores completions/evidence/moderation.

ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'task_reward';
ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'welvura_deposit_reward';

CREATE TABLE user_task_evidence (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE RESTRICT,
  bot_started_at timestamptz,
  telegram_channel_member_at timestamptz,
  kick_follow_azarov_at timestamptz,
  kick_nickname_snapshot text,
  kick_nickname_checked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_task_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  task_code text NOT NULL,
  reward_azc bigint NOT NULL,
  verification_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  reward_transaction_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_task_completions_reward_positive CHECK (reward_azc > 0)
);

CREATE UNIQUE INDEX user_task_completions_user_task_unique
  ON user_task_completions (user_id, task_code);

CREATE INDEX user_task_completions_user_completed_idx
  ON user_task_completions (user_id, completed_at DESC);

CREATE TABLE submission_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key text NOT NULL UNIQUE,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  original_filename text,
  created_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submission_files_size_positive CHECK (byte_size > 0),
  CONSTRAINT submission_files_size_max CHECK (byte_size <= 10485760)
);

CREATE TABLE welvura_account_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL,
  welvura_external_id text NOT NULL,
  screenshot_file_id uuid NOT NULL REFERENCES submission_files (id) ON DELETE RESTRICT,
  status text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  moderated_at timestamptz,
  moderated_by_admin_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT welvura_account_submissions_status_check CHECK (
    status IN ('pending', 'approved', 'rejected')
  ),
  CONSTRAINT welvura_account_submissions_attempt_positive CHECK (attempt_number > 0),
  CONSTRAINT welvura_account_submissions_reject_reason_check CHECK (
    (status <> 'rejected') OR (rejection_reason IS NOT NULL AND length(trim(rejection_reason)) > 0)
  )
);

CREATE UNIQUE INDEX welvura_account_submissions_user_attempt_unique
  ON welvura_account_submissions (user_id, attempt_number);

CREATE UNIQUE INDEX welvura_account_submissions_one_pending_per_user
  ON welvura_account_submissions (user_id)
  WHERE status = 'pending';

CREATE INDEX welvura_account_submissions_status_submitted_idx
  ON welvura_account_submissions (status, submitted_at DESC);

CREATE TABLE welvura_deposit_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  stage_number integer NOT NULL,
  attempt_number integer NOT NULL,
  welvura_external_id text NOT NULL,
  required_deposit_rub bigint NOT NULL,
  reward_azc bigint NOT NULL,
  screenshot_file_id uuid NOT NULL REFERENCES submission_files (id) ON DELETE RESTRICT,
  status text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  moderated_at timestamptz,
  moderated_by_admin_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  rejection_reason text,
  reward_transaction_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT welvura_deposit_submissions_status_check CHECK (
    status IN ('pending', 'approved', 'rejected')
  ),
  CONSTRAINT welvura_deposit_submissions_stage_range CHECK (
    stage_number BETWEEN 1 AND 13
  ),
  CONSTRAINT welvura_deposit_submissions_attempt_positive CHECK (attempt_number > 0),
  CONSTRAINT welvura_deposit_submissions_amounts_positive CHECK (
    required_deposit_rub > 0 AND reward_azc > 0
  ),
  CONSTRAINT welvura_deposit_submissions_reject_reason_check CHECK (
    (status <> 'rejected') OR (rejection_reason IS NOT NULL AND length(trim(rejection_reason)) > 0)
  )
);

CREATE UNIQUE INDEX welvura_deposit_submissions_user_stage_attempt_unique
  ON welvura_deposit_submissions (user_id, stage_number, attempt_number);

CREATE UNIQUE INDEX welvura_deposit_submissions_one_pending_per_stage
  ON welvura_deposit_submissions (user_id, stage_number)
  WHERE status = 'pending';

CREATE INDEX welvura_deposit_submissions_status_submitted_idx
  ON welvura_deposit_submissions (status, submitted_at DESC);

CREATE TABLE welvura_stage_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  stage_number integer NOT NULL,
  submission_id uuid NOT NULL REFERENCES welvura_deposit_submissions (id) ON DELETE RESTRICT,
  reward_azc bigint NOT NULL,
  reward_transaction_id uuid NOT NULL REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  completed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT welvura_stage_completions_stage_range CHECK (
    stage_number BETWEEN 1 AND 13
  )
);

CREATE UNIQUE INDEX welvura_stage_completions_user_stage_unique
  ON welvura_stage_completions (user_id, stage_number);

CREATE UNIQUE INDEX welvura_stage_completions_submission_unique
  ON welvura_stage_completions (submission_id);
