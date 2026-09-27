ALTER TABLE kick_oauth_states
  ADD COLUMN IF NOT EXISTS code_verifier text;

ALTER TABLE kick_accounts
  ADD COLUMN IF NOT EXISTS last_inbound_event_id uuid
    REFERENCES inbound_events (id) ON DELETE RESTRICT;
