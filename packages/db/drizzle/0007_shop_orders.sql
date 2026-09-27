-- Forward-only Shop catalog seed and purchase snapshots.
-- Canonical prices live in domain SHOP_CATALOG; these rows match that catalog.
-- No case, Gram, or RUB inventory withdrawal changes.

ALTER TYPE wallet_transaction_type ADD VALUE 'shop_purchase';
ALTER TYPE wallet_transaction_type ADD VALUE 'shop_refund';

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS product_code text,
  ADD COLUMN IF NOT EXISTS product_name_snapshot text,
  ADD COLUMN IF NOT EXISTS processing_at timestamptz,
  ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS processed_by_admin_id uuid REFERENCES users (id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS purchases_status_created_idx
  ON purchases (status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS purchases_product_code_created_idx
  ON purchases (product_code, created_at DESC, id DESC);

INSERT INTO products (slug, type, price_minor, status, payload)
VALUES
  (
    'welvura-200',
    'shop_manual',
    5555,
    'active',
    '{"title":"200 ₽ Welvura","category":"money","fulfillmentType":"manual","requiredFields":["welvuraId"]}'::jsonb
  ),
  (
    'welvura-500',
    'shop_manual',
    11111,
    'active',
    '{"title":"500 ₽ Welvura","category":"money","fulfillmentType":"manual","requiredFields":["welvuraId"]}'::jsonb
  ),
  (
    'welvura-5000',
    'shop_manual',
    199999,
    'active',
    '{"title":"5 000 ₽ Welvura","category":"money","fulfillmentType":"manual","requiredFields":["welvuraId"]}'::jsonb
  ),
  (
    'donat',
    'shop_manual',
    1000,
    'active',
    '{"title":"Донат на стрим","category":"donations","fulfillmentType":"manual","requiredFields":["displayNickname","donationText"]}'::jsonb
  ),
  (
    'music',
    'shop_manual',
    4000,
    'active',
    '{"title":"Заказать музыку","category":"other","fulfillmentType":"manual","requiredFields":["mediaUrl"]}'::jsonb
  ),
  (
    'streak-freeze',
    'shop_instant',
    1000,
    'active',
    '{"title":"Streak Freeze","category":"other","fulfillmentType":"instant","requiredFields":[]}'::jsonb
  ),
  (
    'premium-6',
    'shop_manual',
    34999,
    'active',
    '{"title":"Telegram Premium 6 месяцев","category":"subs","fulfillmentType":"manual","requiredFields":["telegramUsername"]}'::jsonb
  ),
  (
    'premium-12',
    'shop_manual',
    59999,
    'active',
    '{"title":"Telegram Premium 12 месяцев","category":"subs","fulfillmentType":"manual","requiredFields":["telegramUsername"]}'::jsonb
  ),
  (
    'vip-kick',
    'shop_manual',
    149999,
    'active',
    '{"title":"VIP Kick навсегда","category":"subs","fulfillmentType":"manual","requiredFields":["kickUsername"]}'::jsonb
  )
ON CONFLICT (slug) DO UPDATE SET
  type = EXCLUDED.type,
  price_minor = EXCLUDED.price_minor,
  status = 'active',
  payload = EXCLUDED.payload;
