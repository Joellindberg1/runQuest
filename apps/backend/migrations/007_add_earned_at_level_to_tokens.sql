-- ============================================================
-- Migration 007: Add earned_at_level to user_challenge_tokens
--
-- Enables per-level token tracking so tokens can be reconciled
-- when runs are added or deleted (level-up / level regression).
-- ============================================================

ALTER TABLE user_challenge_tokens
  ADD COLUMN earned_at_level INT;

-- Partial index — only rows with a tracked level (legacy tokens have NULL)
CREATE INDEX idx_tokens_user_level
  ON user_challenge_tokens(user_id, earned_at_level)
  WHERE earned_at_level IS NOT NULL;
