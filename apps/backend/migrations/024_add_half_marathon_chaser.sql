-- Migration 024: Add Half Marathon Chaser + rebalance Thursday pool
--
-- Thursday pool (scheduled Thursday 18:00 Stockholm):
--   5K Friday           spawn_chance 0.15  (was 0.30 — now shares pool)
--   Half Marathon Chaser spawn_chance 0.15
--
-- Combined: 0.15 + 0.15 = 30% chance something fires, then 50/50 between them.

-- Add Half Marathon Chaser template
INSERT INTO event_templates
  (name, type, icon, description, min_km, reward_xp, spawn_chance,
   start_hour, end_hour, end_minute)
VALUES
  ('Half Marathon Chaser', 'participation', 'flag',
   'Log at least 10 km in a single run on Friday, Saturday or Sunday.',
   10, 25, 0.15,
   0, 23, 59);

-- Rebalance 5K Friday: was 0.30 solo, now 0.15 in shared pool
UPDATE event_templates SET spawn_chance = 0.15 WHERE name = '5K Friday';
