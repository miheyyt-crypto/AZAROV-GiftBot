ALTER TABLE stream_gif_submissions
  ADD COLUMN IF NOT EXISTS duration_ms integer NOT NULL DEFAULT 0;

ALTER TABLE stream_donations
  ADD COLUMN IF NOT EXISTS media_content_type text,
  ADD COLUMN IF NOT EXISTS media_duration_ms integer;

UPDATE stream_donations
  SET media_content_type = 'image/gif'
  WHERE kind = 'gif' AND media_content_type IS NULL;

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
      AND media_content_type IS NOT NULL
    )
  );
