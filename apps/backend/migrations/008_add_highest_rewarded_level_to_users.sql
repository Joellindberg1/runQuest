-- ============================================================
-- Migration 008: Add highest_rewarded_level to users
--
-- Tracks the highest level for which challenge tokens have been
-- awarded. Prevents retroactive token bursts for existing users
-- and enables correct token reconciliation on level regression.
-- ============================================================

ALTER TABLE users
  ADD COLUMN highest_rewarded_level INT NOT NULL DEFAULT 0;

-- For existing users: treat their current level as already handled
-- so they don't get a burst of retroactive tokens on the next run.
UPDATE users SET highest_rewarded_level = current_level;

-- Joel Lindberg specifically: set to 20 so the level-21 token
-- gets awarded on his next run (the level-up he never received).
UPDATE users
  SET highest_rewarded_level = 20
  WHERE id = '7f3f75a5-8ac1-4441-a305-25f07daeb957';
