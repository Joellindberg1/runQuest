-- ============================================================
-- Migration 017: Events — Seed event_templates (8 st)
-- ============================================================

-- ── Participation events ──────────────────────────────────────

-- 1. Morgonrunda — dagligt tidsfönster på morgonen
INSERT INTO event_templates
  (name, type, icon, description, min_km, reward_xp, window_hours)
VALUES
  ('Morgonrunda', 'participation', 'sun',
   'Genomför ett pass innan fönstret stänger.',
   3, 25, 4);

-- 2. 5K Friday — varje fredag, min 5 km
INSERT INTO event_templates
  (name, type, icon, description, min_km, reward_xp, window_hours)
VALUES
  ('5K Friday', 'participation', 'zap',
   'Spring minst 5 km på en fredag.',
   5, 25, 24);

-- 3. Hangover Run — specialevent på nyårsdagen
INSERT INTO event_templates
  (name, type, icon, description, min_km, reward_xp, window_hours)
VALUES
  ('Hangover Run', 'participation', 'flame',
   'Spring av ruset — genomför ett pass på nyårsdagen.',
   3, 30, 24);

-- 4. Storm Chaser — kräver regn/åska enligt väder-API
INSERT INTO event_templates
  (name, type, icon, description, min_km, reward_xp, window_hours, requires_weather)
VALUES
  ('Storm Chaser', 'participation', 'cloud-lightning',
   'Spring i dåligt väder — regn eller åska krävs.',
   5, 40, 24, ARRAY['rain', 'drizzle', 'storm']);

-- 5. Lunch Run — kortare fönster mitt på dagen
INSERT INTO event_templates
  (name, type, icon, description, min_km, reward_xp, window_hours)
VALUES
  ('Lunch Run', 'participation', 'coffee',
   'Passa på att springa på lunchen.',
   2, 20, 3);

-- ── Competition events ────────────────────────────────────────

-- 6. Weekly km — veckovis tävling på total distans
INSERT INTO event_templates
  (name, type, icon, description, metric, duration_days,
   reward_xp_1st, reward_xp_2nd, reward_xp_3rd)
VALUES
  ('Weekly km', 'competition', 'trophy',
   'Vem springer längst under veckan?',
   'km', 7, 40, 30, 20);

-- 7. Weekly höjdmeter — veckovis tävling på total höjdmeter
INSERT INTO event_templates
  (name, type, icon, description, metric, duration_days,
   reward_xp_1st, reward_xp_2nd, reward_xp_3rd)
VALUES
  ('Weekly höjdmeter', 'competition', 'mountain',
   'Vem klättrar mest under veckan?',
   'elevation', 7, 40, 30, 20);

-- 8. Monthly km — månadstävling på total distans
INSERT INTO event_templates
  (name, type, icon, description, metric, duration_days,
   reward_xp_1st, reward_xp_2nd, reward_xp_3rd)
VALUES
  ('Monthly km', 'competition', 'trophy',
   'Vem springer längst under månaden?',
   'km', 30, 60, 45, 30);
