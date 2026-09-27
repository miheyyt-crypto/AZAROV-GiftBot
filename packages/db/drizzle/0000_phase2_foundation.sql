-- Forward-only Phase 2 foundation.
-- Production rollback is a previous compatible app artifact, not a DOWN of this file.

CREATE TYPE user_status AS ENUM ('active', 'blocked', 'deleted');
CREATE TYPE wallet_status AS ENUM ('active', 'frozen');
CREATE TYPE wallet_transaction_type AS ENUM (
  'deposit',
  'reward',
  'referral_reward',
  'purchase',
  'bet',
  'prize',
  'refund',
  'admin_adjustment',
  'reversal'
);
CREATE TYPE actor_type AS ENUM ('system', 'user', 'admin', 'worker');
CREATE TYPE referral_status AS ENUM (
  'attributed',
  'pending_activation',
  'activated',
  'rejected',
  'reversed'
);
CREATE TYPE referral_event_type AS ENUM (
  'attributed',
  'activated',
  'reward_granted',
  'rejected',
  'reversed'
);
CREATE TYPE catalog_status AS ENUM ('draft', 'active', 'disabled');
CREATE TYPE task_completion_status AS ENUM ('started', 'completed', 'rejected', 'rewarded');
CREATE TYPE stock_mode AS ENUM ('unlimited', 'tracked');
CREATE TYPE purchase_status AS ENUM ('created', 'paid', 'delivered', 'failed', 'refunded');
CREATE TYPE opening_status AS ENUM ('created', 'settled', 'failed', 'voided');
CREATE TYPE game_settlement_mode AS ENUM ('instant', 'async');
CREATE TYPE game_round_status AS ENUM (
  'created',
  'bet_placed',
  'pending',
  'settled',
  'voided',
  'failed'
);
CREATE TYPE giveaway_status AS ENUM ('draft', 'open', 'closed', 'settled', 'cancelled');
CREATE TYPE giveaway_entry_status AS ENUM ('active', 'rejected');
CREATE TYPE inbound_provider AS ENUM ('telegram', 'kick');
CREATE TYPE inbound_processing_status AS ENUM ('queued', 'processed', 'failed', 'dead');
CREATE TYPE job_owner AS ENUM ('bot', 'worker');
CREATE TYPE job_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'dead');
CREATE TYPE notification_channel AS ENUM ('telegram', 'inbox');
CREATE TYPE notification_status AS ENUM ('pending', 'sent', 'failed');
CREATE TYPE kick_account_status AS ENUM ('active', 'needs_reauth', 'revoked');
CREATE TYPE rng_purpose AS ENUM ('game', 'case', 'giveaway');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  display_name text,
  locale text,
  status user_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX users_status_idx ON users (status);
CREATE INDEX users_created_at_idx ON users (created_at);

CREATE TABLE telegram_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  telegram_user_id bigint NOT NULL UNIQUE,
  username text,
  first_name text,
  last_name text,
  language_code text,
  is_premium boolean NOT NULL DEFAULT false,
  linked_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  is_active boolean NOT NULL DEFAULT true
);
CREATE INDEX telegram_accounts_user_id_idx ON telegram_accounts (user_id);
CREATE INDEX telegram_accounts_username_idx ON telegram_accounts (username);
CREATE UNIQUE INDEX telegram_accounts_one_active_per_user
  ON telegram_accounts (user_id) WHERE is_active = true;

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  ip_hash text,
  user_agent_hash text,
  auth_source text NOT NULL DEFAULT 'telegram_init_data'
);
CREATE INDEX sessions_user_revoked_expires_idx ON sessions (user_id, revoked_at, expires_at);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
CREATE UNIQUE INDEX sessions_one_unrevoked_per_user
  ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE admin_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES admin_roles (id) ON DELETE RESTRICT,
  permission_id uuid NOT NULL REFERENCES admin_permissions (id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX admin_role_permissions_unique
  ON admin_role_permissions (role_id, permission_id);

CREATE TABLE admin_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  role_id uuid NOT NULL REFERENCES admin_roles (id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid REFERENCES users (id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX admin_role_assignments_user_role
  ON admin_role_assignments (user_id, role_id);
CREATE INDEX admin_role_assignments_user_id_idx ON admin_role_assignments (user_id);

CREATE TABLE admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  ip_hash text,
  user_agent_hash text
);
CREATE INDEX admin_sessions_user_revoked_expires_idx
  ON admin_sessions (user_id, revoked_at, expires_at);
CREATE UNIQUE INDEX admin_sessions_one_unrevoked_per_user
  ON admin_sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  balance_minor bigint NOT NULL DEFAULT 0,
  opening_balance_minor bigint NOT NULL DEFAULT 0,
  currency_code text NOT NULL DEFAULT 'INTERNAL',
  version bigint NOT NULL DEFAULT 0,
  status wallet_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallets_balance_non_negative CHECK (balance_minor >= 0),
  CONSTRAINT wallets_opening_balance_non_negative CHECK (opening_balance_minor >= 0)
);
CREATE UNIQUE INDEX wallets_user_id_unique ON wallets (user_id);
COMMENT ON COLUMN wallets.currency_code IS 'PENDING PRODUCT DECISION: code/scale. INTERNAL is a schema placeholder, not a product currency.';
COMMENT ON COLUMN wallets.opening_balance_minor IS 'Runtime creates 0. Non-zero only via isolated V1 importer.';
COMMENT ON COLUMN wallets.balance_minor IS 'Materialized projection: opening_balance_minor + sum(wallet_transactions.amount_minor).';

CREATE TABLE wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES wallets (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  type wallet_transaction_type NOT NULL,
  amount_minor bigint NOT NULL,
  balance_after_minor bigint NOT NULL,
  idempotency_key text NOT NULL,
  reference_type text,
  reference_id uuid,
  reverses_transaction_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  actor_type actor_type NOT NULL,
  actor_id uuid,
  reason text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_transactions_balance_after_non_negative CHECK (balance_after_minor >= 0)
);
CREATE UNIQUE INDEX wallet_transactions_idempotency_key_unique
  ON wallet_transactions (idempotency_key);
CREATE INDEX wallet_transactions_wallet_created_idx
  ON wallet_transactions (wallet_id, created_at);
CREATE INDEX wallet_transactions_reference_idx
  ON wallet_transactions (reference_type, reference_id);
CREATE INDEX wallet_transactions_type_idx ON wallet_transactions (type);

CREATE TABLE referral_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  code text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX referral_codes_one_active_per_user
  ON referral_codes (user_id) WHERE is_active = true;

CREATE TABLE referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  referee_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  referral_code_used text NOT NULL,
  status referral_status NOT NULL DEFAULT 'attributed',
  attributed_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  rejected_at timestamptz,
  reject_reason text,
  CONSTRAINT referrals_no_self_referral CHECK (referrer_user_id <> referee_user_id)
);
CREATE UNIQUE INDEX referrals_referee_unique ON referrals (referee_user_id);
CREATE INDEX referrals_referrer_idx ON referrals (referrer_user_id);
CREATE INDEX referrals_status_attributed_idx ON referrals (status, attributed_at);

CREATE TABLE referral_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES referrals (id) ON DELETE RESTRICT,
  type referral_event_type NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX referral_events_idempotency_key_unique
  ON referral_events (idempotency_key);
CREATE INDEX referral_events_referral_id_idx ON referral_events (referral_id);

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  status catalog_status NOT NULL DEFAULT 'draft',
  reward_type text,
  reward_minor bigint,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN tasks.reward_minor IS 'PENDING PRODUCT DECISION: do not treat empty as a chosen amount.';

CREATE TABLE task_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks (id) ON DELETE RESTRICT,
  type text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE INDEX task_requirements_task_id_idx ON task_requirements (task_id);

CREATE TABLE task_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status task_completion_status NOT NULL DEFAULT 'started',
  completed_at timestamptz,
  reward_transaction_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX task_completions_task_user_unique ON task_completions (task_id, user_id);
CREATE UNIQUE INDEX task_completions_idempotency_key_unique ON task_completions (idempotency_key);
CREATE INDEX task_completions_user_status_idx ON task_completions (user_id, status);
CREATE INDEX task_completions_task_status_idx ON task_completions (task_id, status);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  type text NOT NULL,
  price_minor bigint,
  currency_code text NOT NULL DEFAULT 'INTERNAL',
  stock_mode stock_mode NOT NULL DEFAULT 'unlimited',
  stock_remaining integer,
  status catalog_status NOT NULL DEFAULT 'draft',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN products.price_minor IS 'PENDING PRODUCT DECISION.';

CREATE TABLE purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
  status purchase_status NOT NULL DEFAULT 'created',
  price_minor bigint NOT NULL,
  wallet_transaction_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX purchases_idempotency_key_unique ON purchases (idempotency_key);
CREATE INDEX purchases_user_id_idx ON purchases (user_id);

CREATE TABLE cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  price_minor bigint,
  currency_code text NOT NULL DEFAULT 'INTERNAL',
  status catalog_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE case_reward_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases (id) ON DELETE RESTRICT,
  title text NOT NULL,
  weight integer NOT NULL,
  reward_minor bigint
);
CREATE INDEX case_reward_items_case_id_idx ON case_reward_items (case_id);
COMMENT ON COLUMN case_reward_items.weight IS 'PENDING PRODUCT DECISION: weights/RTP are not chosen.';

CREATE TABLE case_openings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  case_id uuid NOT NULL REFERENCES cases (id) ON DELETE RESTRICT,
  status opening_status NOT NULL DEFAULT 'created',
  result_item_id uuid REFERENCES case_reward_items (id) ON DELETE RESTRICT,
  debit_tx_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  prize_tx_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX case_openings_idempotency_key_unique ON case_openings (idempotency_key);
CREATE INDEX case_openings_user_id_idx ON case_openings (user_id);

CREATE TABLE games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  settlement_mode game_settlement_mode NOT NULL,
  status catalog_status NOT NULL DEFAULT 'draft',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN games.config IS 'PENDING PRODUCT DECISION: no coefficients stored as product truth.';

CREATE TABLE game_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status game_round_status NOT NULL DEFAULT 'created',
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE UNIQUE INDEX game_rounds_idempotency_key_unique ON game_rounds (idempotency_key);
CREATE INDEX game_rounds_user_id_idx ON game_rounds (user_id);
CREATE INDEX game_rounds_status_idx ON game_rounds (status);

CREATE TABLE game_bets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES game_rounds (id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL,
  wallet_tx_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX game_bets_round_id_unique ON game_bets (round_id);

CREATE TABLE rng_draws (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose rng_purpose NOT NULL,
  algorithm text NOT NULL,
  entropy_source text NOT NULL,
  result_int bigint,
  hash text NOT NULL,
  reference_type text,
  reference_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rng_draws_reference_idx ON rng_draws (reference_type, reference_id);

CREATE TABLE game_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES game_rounds (id) ON DELETE RESTRICT,
  rng_draw_id uuid REFERENCES rng_draws (id) ON DELETE RESTRICT,
  result_payload jsonb NOT NULL,
  prize_tx_id uuid REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX game_results_round_id_unique ON game_results (round_id);

CREATE TABLE giveaways (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  status giveaway_status NOT NULL DEFAULT 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE giveaway_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  giveaway_id uuid NOT NULL REFERENCES giveaways (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status giveaway_entry_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX giveaway_entries_giveaway_user_unique
  ON giveaway_entries (giveaway_id, user_id);

CREATE TABLE giveaway_winners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  giveaway_id uuid NOT NULL REFERENCES giveaways (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  entry_id uuid NOT NULL REFERENCES giveaway_entries (id) ON DELETE RESTRICT,
  rng_draw_id uuid REFERENCES rng_draws (id) ON DELETE RESTRICT,
  selected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX giveaway_winners_giveaway_id_idx ON giveaway_winners (giveaway_id);

CREATE TABLE partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  status catalog_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE partner_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX partner_actions_user_id_idx ON partner_actions (user_id);
CREATE INDEX partner_actions_partner_id_idx ON partner_actions (partner_id);

CREATE TABLE kick_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  kick_user_id text NOT NULL UNIQUE,
  access_token_encrypted text,
  refresh_token_encrypted text,
  scope text,
  token_expires_at timestamptz,
  status kick_account_status NOT NULL DEFAULT 'active',
  linked_at timestamptz NOT NULL DEFAULT now(),
  last_refreshed_at timestamptz
);
CREATE INDEX kick_accounts_user_id_idx ON kick_accounts (user_id);
CREATE UNIQUE INDEX kick_accounts_one_active_per_user
  ON kick_accounts (user_id) WHERE status = 'active';

CREATE TABLE kick_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  code_challenge text,
  redirect_purpose text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kick_webhook_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kick_account_id uuid NOT NULL REFERENCES kick_accounts (id) ON DELETE RESTRICT,
  external_id text,
  topic text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inbound_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider inbound_provider NOT NULL,
  event_type text NOT NULL,
  external_event_id text NOT NULL,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL,
  signature_valid boolean NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_status inbound_processing_status NOT NULL DEFAULT 'queued',
  last_error text,
  job_id uuid
);
CREATE UNIQUE INDEX inbound_events_provider_external_id_unique
  ON inbound_events (provider, external_event_id);
CREATE UNIQUE INDEX inbound_events_idempotency_key_unique
  ON inbound_events (idempotency_key);
CREATE INDEX inbound_events_status_received_idx
  ON inbound_events (processing_status, received_at);
CREATE INDEX inbound_events_job_id_idx ON inbound_events (job_id);
COMMENT ON TABLE inbound_events IS 'Variant A: single durable webhook store. No kick_events/telegram_events payload tables.';

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  owner job_owner NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status job_status NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL,
  retry_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  error text,
  result_ref text,
  inbound_event_id uuid REFERENCES inbound_events (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX jobs_type_idempotency_key_unique ON jobs (type, idempotency_key);
CREATE INDEX jobs_claim_idx ON jobs (owner, status, next_attempt_at);
CREATE INDEX jobs_created_at_idx ON jobs (created_at);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  channel notification_channel NOT NULL,
  type text NOT NULL,
  status notification_status NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  job_id uuid REFERENCES jobs (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX notifications_user_status_idx ON notifications (user_id, status);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type actor_type NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  before jsonb,
  after jsonb,
  reason text,
  request_id text,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_type, actor_id);
CREATE INDEX audit_logs_target_idx ON audit_logs (target_type, target_id);
CREATE INDEX audit_logs_created_at_idx ON audit_logs (created_at);

CREATE TABLE idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  route text NOT NULL,
  request_hash text,
  response_status integer,
  response_body_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX idempotency_keys_user_key_unique ON idempotency_keys (user_id, key);
CREATE INDEX idempotency_keys_expires_at_idx ON idempotency_keys (expires_at);

CREATE TABLE app_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME
    USING ERRCODE = '25006';
END;
$$;

CREATE TRIGGER wallet_transactions_append_only
  BEFORE UPDATE OR DELETE ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER referral_events_append_only
  BEFORE UPDATE OR DELETE ON referral_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER rng_draws_append_only
  BEFORE UPDATE OR DELETE ON rng_draws
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER inbound_events_forbid_delete
  BEFORE DELETE ON inbound_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER inbound_events_immutable_receipt
  BEFORE UPDATE ON inbound_events
  FOR EACH ROW
  WHEN (
    OLD.id IS DISTINCT FROM NEW.id
    OR OLD.provider IS DISTINCT FROM NEW.provider
    OR OLD.external_event_id IS DISTINCT FROM NEW.external_event_id
    OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
    OR OLD.payload IS DISTINCT FROM NEW.payload
    OR OLD.received_at IS DISTINCT FROM NEW.received_at
    OR OLD.signature_valid IS DISTINCT FROM NEW.signature_valid
    OR OLD.event_type IS DISTINCT FROM NEW.event_type
  )
  EXECUTE FUNCTION forbid_mutation();

INSERT INTO admin_roles (name) VALUES ('super_admin');
