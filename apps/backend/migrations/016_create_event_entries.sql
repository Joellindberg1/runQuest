-- ============================================================
-- Migration 016: Events — event_entries tabell
-- ============================================================
-- En rad per användare och event.
-- Skapas när en användare kvalificerar sig (participation)
-- eller när eventet sätts igång för alla deltagare (competition).
-- total_value fylls i vid avräkning (settlement).

CREATE TABLE event_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Participation: vilket pass som kvalificerade
  run_id        UUID REFERENCES runs(id),

  -- Sätts när användaren kvalificerar sig / genomför eventet
  qualified_at  TIMESTAMPTZ,

  -- Fylls i vid settlement
  total_value   NUMERIC,             -- slutlig km eller höjdmeter (competition)
  rank          INT,                 -- slutlig placering (competition)
  xp_awarded    INT,                 -- utdelad XP

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (event_id, user_id)
);

-- Index för qualification-check vid run logging
CREATE INDEX idx_event_entries_user_event  ON event_entries(user_id, event_id);
CREATE INDEX idx_event_entries_event       ON event_entries(event_id);
-- Index för titel-beräkning: räkna genomförda participation per användare
CREATE INDEX idx_event_entries_qualified   ON event_entries(user_id, qualified_at) WHERE qualified_at IS NOT NULL;
