ALTER TABLE stream_gif_submissions
  ADD COLUMN IF NOT EXISTS playback_ready boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS prepare_error text;
