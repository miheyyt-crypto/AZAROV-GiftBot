CREATE TABLE v1_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL,
  dry_run boolean NOT NULL DEFAULT false,
  source_sha256 text NOT NULL,
  users_read integer NOT NULL,
  users_imported integer NOT NULL,
  users_skipped integer NOT NULL,
  users_conflicted integer NOT NULL,
  reconcile_ok boolean NOT NULL,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v1_import_runs_mode_check CHECK (mode IN ('snapshot', 'full_history'))
);

CREATE TABLE v1_import_identities (
  telegram_user_id bigint PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  mode text NOT NULL,
  imported_balance_minor bigint NOT NULL,
  source_legacy_id text,
  import_run_id uuid NOT NULL REFERENCES v1_import_runs (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v1_import_identities_mode_check CHECK (mode IN ('snapshot', 'full_history')),
  CONSTRAINT v1_import_identities_balance_non_negative CHECK (imported_balance_minor >= 0)
);

CREATE INDEX v1_import_identities_user_id_idx ON v1_import_identities (user_id);
CREATE INDEX v1_import_runs_created_at_idx ON v1_import_runs (created_at);

COMMENT ON TABLE v1_import_runs IS 'Isolated V1 importer only. Not a runtime store and not store.json.';
COMMENT ON TABLE v1_import_identities IS 'Idempotency for V1 telegram_user_id to V2 user. Runtime does not write this table.';
