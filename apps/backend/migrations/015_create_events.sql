-- ============================================================
-- Migration 015: Events — events tabell
-- ============================================================
-- Instanser av event_templates. Schedulern skapar rader här
-- när ett event schemaläggs för en grupp.

CREATE TABLE events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  UUID NOT NULL REFERENCES event_templates(id),
  group_id     UUID NOT NULL REFERENCES groups(id),

  -- Kopieras från template vid skapande (snabba queries utan join)
  type         TEXT NOT NULL,        -- 'participation' | 'competition'
  metric       TEXT,                 -- 'km' | 'elevation' | NULL

  status       TEXT NOT NULL DEFAULT 'scheduled',
  -- 'scheduled' → väntar på starts_at
  -- 'active'    → öppet för deltagande
  -- 'settled'   → stängt och avräknat
  -- 'cancelled' → inställt

  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ NOT NULL,
  settled_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT events_status_check
    CHECK (status IN ('scheduled', 'active', 'settled', 'cancelled')),
  CONSTRAINT events_dates_check
    CHECK (ends_at > starts_at)
);

-- Index för schedulern och API-queries
CREATE INDEX idx_events_group_status  ON events(group_id, status);
CREATE INDEX idx_events_active        ON events(status, ends_at) WHERE status = 'active';
CREATE INDEX idx_events_scheduled     ON events(starts_at) WHERE status = 'scheduled';
