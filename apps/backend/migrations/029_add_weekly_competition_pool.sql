-- Migration 029: weekly_competition pool
-- Ensures only ONE of "Weekly km" / "Weekly elevation" is created each week.
-- 35% trigger chance → roughly 2 out of 5 weeks get a weekly competition.
-- Equal weights (1.0 each) → 50/50 between the two templates.

INSERT INTO event_pools (name, trigger_chance, description) VALUES
  ('weekly_competition', 0.35, 'Lördag 20:00 Stockholm — Weekly km / Weekly höjdmeter, max ett per vecka');

INSERT INTO event_pool_members (pool_id, template_id, weight, condition)
SELECT p.id, t.id, 1.0, NULL
FROM event_pools p, event_templates t
WHERE p.name = 'weekly_competition'
  AND t.name IN ('Weekly km', 'Weekly elevation');
