-- Migration 023: increment_event_xp now also increments total_xp
-- Event XP should count toward levels, not just be a separate stat.
-- event_xp is kept as a display column (shows how much XP came from events).

CREATE OR REPLACE FUNCTION increment_event_xp(p_user_id UUID, p_xp INT)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE users
  SET event_xp = event_xp + p_xp,
      total_xp  = total_xp  + p_xp
  WHERE id = p_user_id;
$$;
