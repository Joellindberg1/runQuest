-- Database triggers to automatically update user totals when runs are modified
-- This ensures user totals stay in sync regardless of how runs are added/removed

-- Function to recalculate user totals
CREATE OR REPLACE FUNCTION update_user_totals()
RETURNS TRIGGER AS $$
DECLARE
    affected_user_id UUID;
    total_xp_val INTEGER;
    total_km_val NUMERIC;
    current_level_val INTEGER;
BEGIN
    -- Determine which user was affected
    IF TG_OP = 'DELETE' THEN
        affected_user_id := OLD.user_id;
    ELSE
        affected_user_id := NEW.user_id;
    END IF;
    
    -- Calculate new totals for the affected user
    SELECT 
        COALESCE(SUM(xp_gained), 0),
        COALESCE(SUM(distance), 0)
    INTO total_xp_val, total_km_val
    FROM runs 
    WHERE user_id = affected_user_id;
    
    -- Calculate level from XP (simple formula, adjust as needed)
    -- Level 1 = 0-99 XP, Level 2 = 100-249 XP, Level 3 = 250-449 XP, etc.
    current_level_val := GREATEST(1, FLOOR(SQRT(total_xp_val / 100)) + 1);
    
    -- Update user totals
    UPDATE users 
    SET 
        total_xp = total_xp_val,
        total_km = total_km_val,
        current_level = current_level_val,
        updated_at = NOW()
    WHERE id = affected_user_id;
    
    -- Log the update for debugging
    RAISE NOTICE 'Updated user % totals: XP=%, KM=%, Level=%', 
                 affected_user_id, total_xp_val, total_km_val, current_level_val;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create triggers for INSERT, UPDATE, and DELETE on runs table
DROP TRIGGER IF EXISTS trigger_update_user_totals_insert ON runs;
DROP TRIGGER IF EXISTS trigger_update_user_totals_update ON runs;  
DROP TRIGGER IF EXISTS trigger_update_user_totals_delete ON runs;

CREATE TRIGGER trigger_update_user_totals_insert
    AFTER INSERT ON runs
    FOR EACH ROW
    EXECUTE FUNCTION update_user_totals();

CREATE TRIGGER trigger_update_user_totals_update
    AFTER UPDATE ON runs
    FOR EACH ROW
    WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id OR 
          OLD.xp_gained IS DISTINCT FROM NEW.xp_gained OR 
          OLD.distance IS DISTINCT FROM NEW.distance)
    EXECUTE FUNCTION update_user_totals();

CREATE TRIGGER trigger_update_user_totals_delete
    AFTER DELETE ON runs
    FOR EACH ROW
    EXECUTE FUNCTION update_user_totals();

-- Test the triggers work by checking current state
SELECT 
    u.name,
    u.total_xp,
    u.total_km,
    u.current_level,
    (SELECT COUNT(*) FROM runs WHERE user_id = u.id) as run_count,
    (SELECT COALESCE(SUM(xp_gained), 0) FROM runs WHERE user_id = u.id) as calculated_xp,
    (SELECT COALESCE(SUM(distance), 0) FROM runs WHERE user_id = u.id) as calculated_km
FROM users u
WHERE u.name ILIKE '%nicklas%'
ORDER BY u.name;