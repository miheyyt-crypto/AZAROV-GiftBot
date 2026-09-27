-- Optional public image path for giveaways. Existing rows stay NULL.
ALTER TABLE giveaways
ADD COLUMN IF NOT EXISTS image_url text;
