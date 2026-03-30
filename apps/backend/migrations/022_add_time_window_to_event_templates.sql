-- Migration 022: Replace window_hours with start_hour / end_hour / end_minute
-- Moves event timing from hardcoded scheduler values into the database.
-- competition templates (Weekly km/höjdmeter) use NULL — their dates are
-- computed dynamically by the Saturday cron (Monday 00:01 → Sunday 23:59).

ALTER TABLE event_templates
  ADD COLUMN IF NOT EXISTS start_hour  SMALLINT,
  ADD COLUMN IF NOT EXISTS end_hour    SMALLINT,
  ADD COLUMN IF NOT EXISTS end_minute  SMALLINT NOT NULL DEFAULT 0;

-- Daily 19:00 participation pool
UPDATE event_templates SET start_hour = 5,  end_hour = 9,  end_minute = 0  WHERE name = 'Morgonrunda';
UPDATE event_templates SET start_hour = 18, end_hour = 22, end_minute = 0  WHERE name = 'Kvällsrunda';
UPDATE event_templates SET start_hour = 0,  end_hour = 23, end_minute = 59 WHERE name = 'Storm Chaser';

-- Weekend / Thursday standalone pools (full-day)
UPDATE event_templates SET start_hour = 0,  end_hour = 23, end_minute = 59 WHERE name = 'Hangover Run';
UPDATE event_templates SET start_hour = 0,  end_hour = 23, end_minute = 59 WHERE name = '5K Friday';

-- Drop unused window_hours column
ALTER TABLE event_templates DROP COLUMN IF EXISTS window_hours;
