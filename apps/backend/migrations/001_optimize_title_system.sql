-- Migration: Optimize Title System for Performance
-- Description: Add cached title holders and runners-up for efficient querying
-- Date: 2025-10-03

-- 1. Create title_leaderboard table for cached rankings
CREATE TABLE IF NOT EXISTS title_leaderboard (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title_id UUID NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1 AND position <= 10),
  value DECIMAL(10,2) NOT NULL,
  earned_at TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(title_id, position),
  UNIQUE(title_id, user_id)
);

-- 2. Add indexes for optimal performance
CREATE INDEX IF NOT EXISTS idx_title_leaderboard_title_position 
ON title_leaderboard (title_id, position);

CREATE INDEX IF NOT EXISTS idx_title_leaderboard_updated_at 
ON title_leaderboard (updated_at);

-- 3. Add updated_at column to titles table if not exists
ALTER TABLE titles 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 4. Create function to update title leaderboard
CREATE OR REPLACE FUNCTION update_title_leaderboard(p_title_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Delete existing leaderboard for this title
  DELETE FROM title_leaderboard WHERE title_id = p_title_id;
  
  -- Insert top 10 performers for this title
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
  
  -- Update the titles table with current holder
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

-- 5. Create function to update all title leaderboards
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

-- 6. Create trigger to auto-update leaderboard when user_titles change
CREATE OR REPLACE FUNCTION trigger_update_title_leaderboard()
RETURNS TRIGGER AS $$
BEGIN
  -- Handle INSERT and UPDATE
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    PERFORM update_title_leaderboard(NEW.title_id);
    RETURN NEW;
  END IF;
  
  -- Handle DELETE
  IF TG_OP = 'DELETE' THEN
    PERFORM update_title_leaderboard(OLD.title_id);
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS title_leaderboard_update_trigger ON user_titles;

-- Create the trigger
CREATE TRIGGER title_leaderboard_update_trigger
  AFTER INSERT OR UPDATE OR DELETE ON user_titles
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_title_leaderboard();

-- 7. Initial population of title leaderboard
SELECT update_all_title_leaderboards();

-- 8. Create optimized view for easy querying
CREATE OR REPLACE VIEW title_leaderboard_view AS
SELECT 
  t.id as title_id,
  t.name as title_name,
  t.description as title_description,
  t.unlock_requirement,
  tl.position,
  tl.user_id,
  u.name as user_name,
  u.profile_picture,
  tl.value,
  tl.earned_at,
  CASE 
    WHEN tl.position = 1 THEN 'holder'
    WHEN tl.position <= 3 THEN 'runner_up'
    ELSE 'top_10'
  END as status
FROM titles t
LEFT JOIN title_leaderboard tl ON t.id = tl.title_id
LEFT JOIN users u ON tl.user_id = u.id
ORDER BY t.name, tl.position;

-- 9. Grant permissions
GRANT SELECT ON title_leaderboard TO authenticated;
GRANT SELECT ON title_leaderboard_view TO authenticated;
GRANT EXECUTE ON FUNCTION update_title_leaderboard(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION update_all_title_leaderboards() TO service_role;

-- 10. Add helpful comments
COMMENT ON TABLE title_leaderboard IS 'Cached title rankings for optimal performance - top 10 per title';
COMMENT ON FUNCTION update_title_leaderboard IS 'Updates leaderboard for a specific title - called automatically via triggers';
COMMENT ON VIEW title_leaderboard_view IS 'Easy-to-query view combining titles with their current leaderboard';