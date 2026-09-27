-- Expand identity avatar metadata. URLs only; no binary images.
ALTER TABLE telegram_accounts
  ADD COLUMN IF NOT EXISTS photo_url text;

ALTER TABLE kick_accounts
  ADD COLUMN IF NOT EXISTS display_name text;

ALTER TABLE kick_accounts
  ADD COLUMN IF NOT EXISTS avatar_url text;
