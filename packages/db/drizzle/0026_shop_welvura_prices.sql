-- Shop catalog: Welvura 200/500 and bonus 3000 AZC prices.
-- Canonical values live in domain SHOP_CATALOG; this keeps products.price_minor aligned.

UPDATE products SET price_minor = 11111 WHERE slug = 'welvura-200';
UPDATE products SET price_minor = 22222 WHERE slug = 'welvura-500';
UPDATE products SET price_minor = 77777 WHERE slug = 'welvura-bonus-3000';
