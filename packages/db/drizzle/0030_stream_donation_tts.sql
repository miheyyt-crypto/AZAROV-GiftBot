DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stream_donation_tts_status') THEN
    CREATE TYPE stream_donation_tts_status AS ENUM ('pending', 'ready', 'failed', 'skipped');
  END IF;
END $$;

ALTER TABLE stream_donations
  ADD COLUMN IF NOT EXISTS tts_status stream_donation_tts_status NOT NULL DEFAULT 'skipped',
  ADD COLUMN IF NOT EXISTS tts_voice text,
  ADD COLUMN IF NOT EXISTS tts_duration_ms integer,
  ADD COLUMN IF NOT EXISTS tts_error text,
  ADD COLUMN IF NOT EXISTS tts_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS playing_expires_at timestamptz;

ALTER TABLE stream_donations DROP CONSTRAINT IF EXISTS stream_donations_tts_duration_nonneg;
ALTER TABLE stream_donations
  ADD CONSTRAINT stream_donations_tts_duration_nonneg
  CHECK (tts_duration_ms IS NULL OR tts_duration_ms >= 0);
