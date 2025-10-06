-- STEG 5: Skapa triggers
CREATE OR REPLACE FUNCTION trigger_update_title_leaderboard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    PERFORM update_title_leaderboard(NEW.title_id);
    RETURN NEW;
  END IF;
  
  IF TG_OP = 'DELETE' THEN
    PERFORM update_title_leaderboard(OLD.title_id);
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS title_leaderboard_update_trigger ON user_titles;

CREATE TRIGGER title_leaderboard_update_trigger
  AFTER INSERT OR UPDATE OR DELETE ON user_titles
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_title_leaderboard();

-- STEG 6: Populera data
SELECT update_all_title_leaderboards();