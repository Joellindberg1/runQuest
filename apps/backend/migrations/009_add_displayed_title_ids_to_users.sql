-- Migration 009: Add displayed_title_ids to users
-- Allows users to choose which titles (up to 3) to display on the leaderboard,
-- and in what order.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS displayed_title_ids TEXT[] NOT NULL DEFAULT '{}';
