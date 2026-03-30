-- ============================================================
-- Migration 019: increment_event_xp RPC-funktion
-- ============================================================
-- Atomärt ökar event_xp på en user. Används av eventService
-- direkt efter att en participation-entry skapats.

CREATE OR REPLACE FUNCTION increment_event_xp(p_user_id UUID, p_xp INT)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE users
  SET event_xp = event_xp + p_xp
  WHERE id = p_user_id;
$$;
