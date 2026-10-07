ALTER TABLE stream_donations
  ADD COLUMN IF NOT EXISTS shop_purchase_id uuid REFERENCES purchases (id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS stream_donations_shop_purchase_unique
  ON stream_donations (shop_purchase_id);

ALTER TABLE stream_donations DROP CONSTRAINT IF EXISTS stream_donations_message_max;
ALTER TABLE stream_donations
  ADD CONSTRAINT stream_donations_message_max CHECK (char_length(message) <= 300);
