-- STEG 4: Skapa funktioner
CREATE OR REPLACE FUNCTION update_title_leaderboard(p_title_id UUID)
RETURNS VOID AS $$
BEGIN
  DELETE FROM title_leaderboard WHERE title_id = p_title_id;
  
  INSERT INTO title_leaderboard (title_id, user_id, position, value, earned_at)
  SELECT 
    p_title_id,
    ut.user_id,
    ROW_NUMBER() OVER (ORDER BY ut.value DESC, ut.earned_at ASC) as position,
    ut.value,
    ut.earned_at
  FROM user_titles ut
  WHERE ut.title_id = p_title_id 
    AND ut.value IS NOT NULL
  ORDER BY ut.value DESC, ut.earned_at ASC
  LIMIT 10;
  
  UPDATE titles 
  SET 
    current_holder_id = (
      SELECT user_id FROM title_leaderboard 
      WHERE title_id = p_title_id AND position = 1
    ),
    current_value = (
      SELECT value FROM title_leaderboard 
      WHERE title_id = p_title_id AND position = 1
    ),
    updated_at = NOW()
  WHERE id = p_title_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_all_title_leaderboards()
RETURNS VOID AS $$
DECLARE
  title_record RECORD;
BEGIN
  FOR title_record IN SELECT id FROM titles LOOP
    PERFORM update_title_leaderboard(title_record.id);
  END LOOP;
END;
$$ LANGUAGE plpgsql;