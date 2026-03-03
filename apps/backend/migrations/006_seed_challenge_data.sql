-- ============================================================
-- Migration 006: Challenge System — Seed Data (MVP)
-- ============================================================

-- challenge_metrics
INSERT INTO challenge_metrics (metric, description, tier_eligibility) VALUES
  ('km',       'Vem springer längst totalt?', ARRAY['minor', 'major']),
  ('runs',     'Vem springer flest rundor?',  ARRAY['minor', 'major']),
  ('total_xp', 'Vem samlar mest XP?',         ARRAY['minor', 'major', 'legendary']);

-- challenge_durations
INSERT INTO challenge_durations (duration_days, tier_eligibility) VALUES
  (5,  ARRAY['minor']),
  (7,  ARRAY['minor', 'major']),
  (10, ARRAY['major']),
  (14, ARRAY['major', 'legendary']),
  (21, ARRAY['legendary']),
  (30, ARRAY['legendary']);

-- challenge_rewards
INSERT INTO challenge_rewards
  (tier_eligibility, winner_type, winner_delta, winner_duration,
   loser_type, loser_delta, loser_duration, description)
VALUES
  (ARRAY['minor'],
   'multiplier_days', 0.15, 5,
   'multiplier_days', -0.07, 5,
   '+0.15x/5d vs -0.07x/5d'),
  (ARRAY['major'],
   'multiplier_days', 0.25, 10,
   'multiplier_days', -0.12, 10,
   '+0.25x/10d vs -0.12x/10d'),
  (ARRAY['legendary'],
   'multiplier_days', 0.50, 14,
   'multiplier_days', -0.25, 14,
   '+0.50x/14d vs -0.25x/14d');

-- level_challenge_rewards
-- Levels 3-15 (gradual start)
-- Level 16+: minor every level, major every 5th (20,25,30...), legendary every 15th (30,45...)
INSERT INTO level_challenge_rewards (level, tier) VALUES
  (3,  'minor'),
  (5,  'major'),
  (8,  'minor'),
  (10, 'major'),
  (12, 'minor'),
  (14, 'minor'),
  (15, 'legendary'),
  (16, 'minor'),
  (17, 'minor'),
  (18, 'minor'),
  (19, 'minor'),
  (20, 'major'),
  (21, 'minor'),
  (22, 'minor'),
  (23, 'minor'),
  (24, 'minor'),
  (25, 'major'),
  (26, 'minor'),
  (27, 'minor'),
  (28, 'minor'),
  (29, 'minor'),
  (30, 'legendary'),
  (31, 'minor'),
  (32, 'minor'),
  (33, 'minor'),
  (34, 'minor'),
  (35, 'major'),
  (36, 'minor'),
  (37, 'minor'),
  (38, 'minor'),
  (39, 'minor'),
  (40, 'major'),
  (41, 'minor'),
  (42, 'minor'),
  (43, 'minor'),
  (44, 'minor'),
  (45, 'legendary'),
  (46, 'minor'),
  (47, 'minor'),
  (48, 'minor'),
  (49, 'minor'),
  (50, 'major');
