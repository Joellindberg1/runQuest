-- Migration 013: Create run_weather table
-- Stores weather conditions at the time and location of each run.
-- Fetched from Open-Meteo after Strava sync, before title calculation.
-- Only populated for outdoor runs (is_treadmill = false) with coordinates.
-- A missing row means weather data has not yet been fetched — not that it failed.

CREATE TABLE IF NOT EXISTS run_weather (
  run_id             UUID PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  temperature_c      NUMERIC(4,1),
  apparent_temp_c    NUMERIC(4,1),
  humidity_pct       SMALLINT,
  precipitation_mm   NUMERIC(4,1),
  snowfall_cm        NUMERIC(4,1),
  snow_depth_cm      NUMERIC(4,1),
  wind_speed_ms      NUMERIC(4,1),
  wind_gusts_ms      NUMERIC(4,1),
  wind_direction_deg SMALLINT,
  weather_code       SMALLINT,
  uv_index           NUMERIC(3,1),
  visibility_m       INTEGER,
  fetched_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
