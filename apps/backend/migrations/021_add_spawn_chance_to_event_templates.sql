-- Migration 021: Add spawn_chance to event_templates
-- Controls the individual weight used in the daily weighted draw.
-- The scheduler first rolls one shared die (sum of all candidate weights),
-- then a second weighted die picks which event fires — at most one per draw.

ALTER TABLE event_templates
  ADD COLUMN IF NOT EXISTS spawn_chance NUMERIC(3,2) NOT NULL DEFAULT 1.0;

-- Daily 19:00 pool (Morgonrunda + Kvällsrunda + Storm Chaser compete for one slot)
UPDATE event_templates SET spawn_chance = 0.10 WHERE name = 'Morgonrunda';
UPDATE event_templates SET spawn_chance = 0.10 WHERE name = 'Kvällsrunda';
UPDATE event_templates SET spawn_chance = 0.30 WHERE name = 'Storm Chaser';

-- Weekend pool — each has its own cron, independent spawn chance
UPDATE event_templates SET spawn_chance = 0.20 WHERE name = 'Hangover Run';

-- Thursday pool — 5K Friday (was 30% → 50/50 with Halvmaraton-jakten, now solo at 30%)
UPDATE event_templates SET spawn_chance = 0.30 WHERE name = '5K Friday';

-- Weekly competitions always run (deterministic weekly schedule)
-- Weekly km and Weekly höjdmeter stay at 1.0
