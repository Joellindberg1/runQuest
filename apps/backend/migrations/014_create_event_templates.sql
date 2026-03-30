-- ============================================================
-- Migration 014: Events — event_templates tabell
-- ============================================================
-- Definierar återanvändbara event-typer (config).
-- Nya event-typer = nya rader, inga kodändringar.

CREATE TABLE event_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  type             TEXT NOT NULL,        -- 'participation' | 'competition'
  icon             TEXT NOT NULL DEFAULT 'calendar',
  description      TEXT,

  -- Participation-specifikt
  min_km           NUMERIC,             -- minsta distans för att kvalificera sig
  reward_xp        INT,                 -- XP vid genomfört participation
  window_hours     INT,                 -- hur länge fönstret är öppet (timmar)
  requires_weather TEXT[],              -- nödvändiga väderförhållanden (t.ex. Storm Chaser)

  -- Competition-specifikt
  metric           TEXT,                -- 'km' | 'elevation'
  duration_days    INT,                 -- hur många dagar tävlingen pågår
  reward_xp_1st    INT,                 -- XP för 1:a plats
  reward_xp_2nd    INT,                 -- XP för 2:a plats
  reward_xp_3rd    INT,                 -- XP för 3:e plats

  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT event_templates_type_check
    CHECK (type IN ('participation', 'competition'))
);
