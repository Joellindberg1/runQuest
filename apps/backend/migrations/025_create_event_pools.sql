-- Migration 025: event_pools + event_pool_members
-- Separates "does the pool fire?" (trigger_chance on pool)
-- from "which event wins?" (weight on member).

CREATE TABLE event_pools (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL UNIQUE,
  trigger_chance  NUMERIC(4,2) NOT NULL,
  description     TEXT
);

CREATE TABLE event_pool_members (
  pool_id     UUID NOT NULL REFERENCES event_pools(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES event_templates(id) ON DELETE CASCADE,
  weight      NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  condition   TEXT DEFAULT NULL,   -- NULL = always included, 'weather' = only if weather qualifies
  PRIMARY KEY (pool_id, template_id)
);

-- ── Seed pools ────────────────────────────────────────────────────────────────

INSERT INTO event_pools (name, trigger_chance, description) VALUES
  ('daily',    0.20, 'Weekdays 19:00 Stockholm — Morning run / Evening run / Storm Chaser'),
  ('thursday', 0.30, 'Thursdays 18:00 Stockholm — 5K Friday / Half Marathon Chaser'),
  ('weekend',  0.20, 'Fri+Sat 22:00 Stockholm — Hangover Run');

-- ── Seed members ──────────────────────────────────────────────────────────────

INSERT INTO event_pool_members (pool_id, template_id, weight, condition)
SELECT p.id, t.id, 1.0, NULL
FROM event_pools p, event_templates t
WHERE p.name = 'daily' AND t.name IN ('Morning run', 'Evening run');

INSERT INTO event_pool_members (pool_id, template_id, weight, condition)
SELECT p.id, t.id, 3.0, 'weather'
FROM event_pools p, event_templates t
WHERE p.name = 'daily' AND t.name = 'Storm Chaser';

INSERT INTO event_pool_members (pool_id, template_id, weight, condition)
SELECT p.id, t.id, 1.0, NULL
FROM event_pools p, event_templates t
WHERE p.name = 'thursday' AND t.name IN ('5K Friday', 'Half Marathon Chaser');

INSERT INTO event_pool_members (pool_id, template_id, weight, condition)
SELECT p.id, t.id, 1.0, NULL
FROM event_pools p, event_templates t
WHERE p.name = 'weekend' AND t.name = 'Hangover Run';
