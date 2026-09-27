-- Align column DEFAULT with domain ROLLS_SPIN_MS (8000).
-- 0015 created DEFAULT 10000; domain always writes spin_duration_ms on insert/lock.
-- Betting remains 20s (ROLLS_COUNTDOWN_MS); this default is spin-only.
ALTER TABLE rolls_rounds
  ALTER COLUMN spin_duration_ms SET DEFAULT 8000;
