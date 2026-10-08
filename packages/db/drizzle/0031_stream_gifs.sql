DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stream_donation_kind') THEN
    CREATE TYPE stream_donation_kind AS ENUM ('donation', 'gif');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stream_gif_submission_status') THEN
    CREATE TYPE stream_gif_submission_status AS ENUM (
      'staging',
      'pending_moderation',
      'queued',
      'rejected'
    );
  END IF;
END $$;

ALTER TABLE stream_donations
  ADD COLUMN IF NOT EXISTS kind stream_donation_kind NOT NULL DEFAULT 'donation',
  ADD COLUMN IF NOT EXISTS media_storage_key text,
  ADD COLUMN IF NOT EXISTS media_width integer,
  ADD COLUMN IF NOT EXISTS media_height integer,
  ADD COLUMN IF NOT EXISTS media_frame_count integer,
  ADD COLUMN IF NOT EXISTS playback_outcome text;

ALTER TABLE stream_donations DROP CONSTRAINT IF EXISTS stream_donations_kind_media;
ALTER TABLE stream_donations
  ADD CONSTRAINT stream_donations_kind_media CHECK (
    (kind = 'donation' AND media_storage_key IS NULL)
    OR (
      kind = 'gif'
      AND media_storage_key IS NOT NULL
      AND media_width IS NOT NULL
      AND media_height IS NOT NULL
      AND media_frame_count IS NOT NULL
    )
  );

ALTER TABLE stream_donations DROP CONSTRAINT IF EXISTS stream_donations_playback_outcome;
ALTER TABLE stream_donations
  ADD CONSTRAINT stream_donations_playback_outcome CHECK (
    playback_outcome IS NULL
    OR playback_outcome IN ('succeeded', 'failed', 'dismissed')
  );

CREATE INDEX IF NOT EXISTS stream_donations_kind_status_idx
  ON stream_donations (kind, status);

CREATE TABLE IF NOT EXISTS stream_gif_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  shop_purchase_id uuid REFERENCES purchases (id) ON DELETE RESTRICT,
  stream_donation_id uuid REFERENCES stream_donations (id) ON DELETE RESTRICT,
  status stream_gif_submission_status NOT NULL DEFAULT 'staging',
  staging_storage_key text NOT NULL,
  accepted_storage_key text,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  frame_count integer NOT NULL,
  rejection_reason text,
  moderated_by_admin_id uuid,
  moderated_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stream_gif_submissions_size_positive CHECK (byte_size > 0),
  CONSTRAINT stream_gif_submissions_dims_positive CHECK (width > 0 AND height > 0 AND frame_count > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS stream_gif_submissions_purchase_unique
  ON stream_gif_submissions (shop_purchase_id)
  WHERE shop_purchase_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS stream_gif_submissions_donation_unique
  ON stream_gif_submissions (stream_donation_id)
  WHERE stream_donation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS stream_gif_submissions_user_created_idx
  ON stream_gif_submissions (user_id, created_at);

CREATE INDEX IF NOT EXISTS stream_gif_submissions_status_idx
  ON stream_gif_submissions (status);
