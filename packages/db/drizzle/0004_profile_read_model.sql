-- Forward-only Mini App profile read-model foundation.
-- No mutation/business flows. GET remains read-only.

CREATE TYPE welvura_link_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE inventory_item_type AS ENUM ('cash_rub', 'streak_freeze');
CREATE TYPE inventory_item_status AS ENUM ('available', 'reserved', 'consumed');

ALTER TABLE kick_accounts
  ADD COLUMN IF NOT EXISTS username text;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS body text,
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications (user_id, created_at DESC, id DESC);

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS submitted_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS purchases_user_created_idx
  ON purchases (user_id, created_at DESC, id DESC);

CREATE TABLE gram_balances (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gram_balances_amount_non_negative CHECK (amount_minor >= 0)
);

CREATE TABLE user_progress (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE RESTRICT,
  total_xp bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_progress_xp_non_negative CHECK (total_xp >= 0)
);

CREATE TABLE user_kick_stats (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE RESTRICT,
  chat_messages_counted bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_kick_stats_messages_non_negative CHECK (chat_messages_counted >= 0)
);

CREATE TABLE welvura_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE RESTRICT,
  welvura_external_id text,
  status welvura_link_status NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  item_type inventory_item_type NOT NULL,
  status inventory_item_status NOT NULL DEFAULT 'available',
  quantity integer NOT NULL DEFAULT 1,
  amount_rub bigint,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_items_quantity_positive CHECK (quantity >= 0),
  CONSTRAINT inventory_items_cash_amount CHECK (
    (item_type = 'cash_rub' AND amount_rub IS NOT NULL AND amount_rub >= 0)
    OR (item_type = 'streak_freeze' AND amount_rub IS NULL)
  )
);
CREATE INDEX inventory_items_user_type_status_idx
  ON inventory_items (user_id, item_type, status);
CREATE INDEX inventory_items_user_created_idx
  ON inventory_items (user_id, created_at DESC, id DESC);
