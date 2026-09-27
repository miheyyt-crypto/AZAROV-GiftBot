-- Telegram Premium is no longer sold in the shop.
-- Keep product rows (purchases still reference them) and disable new buy.
UPDATE products
SET status = 'disabled'
WHERE slug IN ('premium-6', 'premium-12');
