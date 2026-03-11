-- Migration 010: Add extended run data columns
-- All new columns are nullable — a run is never invalid just because
-- a user hasn't shared certain data or their device doesn't support it.
--
-- pace_std_dev  : computed from Strava splits_metric at sync time (Consistent King/Queen title)
-- avg_heartrate : Strava average_heartrate (requires HR monitor)
-- max_heartrate : Strava max_heartrate (requires HR monitor)
-- suffer_score  : Strava relative effort — effort relative to the athlete's own fitness level
-- start_lat/lng : Strava start_latlng — stored for future weather integration
-- sport_type    : 'Run', 'TrailRun', 'VirtualRun' — NULL for manual runs
--                 VirtualRun = treadmill; excluded from outdoor-only title calculations

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS pace_std_dev FLOAT,
  ADD COLUMN IF NOT EXISTS avg_heartrate FLOAT,
  ADD COLUMN IF NOT EXISTS max_heartrate FLOAT,
  ADD COLUMN IF NOT EXISTS suffer_score INTEGER,
  ADD COLUMN IF NOT EXISTS start_lat FLOAT,
  ADD COLUMN IF NOT EXISTS start_lng FLOAT;

ALTER TABLE runs
  ADD CONSTRAINT runs_sport_type_check
  CHECK (sport_type IS NULL OR sport_type IN ('Run', 'TrailRun', 'VirtualRun'));
