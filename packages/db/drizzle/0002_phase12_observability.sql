ALTER TABLE inbound_events
  ADD COLUMN IF NOT EXISTS correlation_id text;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS correlation_id text;

CREATE INDEX IF NOT EXISTS inbound_events_correlation_id_idx
  ON inbound_events (correlation_id);

CREATE INDEX IF NOT EXISTS jobs_correlation_id_idx
  ON jobs (correlation_id);
