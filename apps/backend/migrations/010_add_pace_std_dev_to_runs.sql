-- Migration 010: Add extended run columns
-- pace_std_dev: computed from Strava splits_metric at sync time (Consistent King/Queen title)
-- avg_heartrate: from Strava average_heartrate
-- max_heartrate: from Strava max_heartrate

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS pace_std_dev FLOAT,
  ADD COLUMN IF NOT EXISTS avg_heartrate FLOAT,
  ADD COLUMN IF NOT EXISTS max_heartrate FLOAT;
