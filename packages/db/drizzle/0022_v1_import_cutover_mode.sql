-- Expand V1 import run/identity mode so the isolated cutover tool can record apply runs.
ALTER TABLE v1_import_runs
  DROP CONSTRAINT IF EXISTS v1_import_runs_mode_check;
ALTER TABLE v1_import_runs
  ADD CONSTRAINT v1_import_runs_mode_check
  CHECK (mode IN ('snapshot', 'full_history', 'cutover'));

ALTER TABLE v1_import_identities
  DROP CONSTRAINT IF EXISTS v1_import_identities_mode_check;
ALTER TABLE v1_import_identities
  ADD CONSTRAINT v1_import_identities_mode_check
  CHECK (mode IN ('snapshot', 'full_history', 'cutover'));
