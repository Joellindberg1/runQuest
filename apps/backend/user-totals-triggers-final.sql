-- User Totals Auto-Update Triggers
-- Copy this entire SQL block and paste it into Supabase SQL Editor

-- Step 1: Create the function
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
    current_level_val := GREATEST(1, FLOOR(SQRT(total_xp_val / 100)) + 1);
    
    -- Update user totals
    UPDATE users 
    SET 
        total_xp = total_xp_val,
        total_km = total_km_val,
        current_level = current_level_val,
        updated_at = NOW()
    WHERE id = affected_user_id;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Step 2: Drop existing triggers if they exist
DROP TRIGGER IF EXISTS trigger_update_user_totals_insert ON runs;
DROP TRIGGER IF EXISTS trigger_update_user_totals_update ON runs;
DROP TRIGGER IF EXISTS trigger_update_user_totals_delete ON runs;

-- Step 3: Create new triggers
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

-- Step 4: Verify triggers are created (optional check)
SELECT 
    trigger_name, 
    event_manipulation, 
    action_timing
FROM information_schema.triggers 
WHERE trigger_name LIKE '%user_totals%'
ORDER BY trigger_name;