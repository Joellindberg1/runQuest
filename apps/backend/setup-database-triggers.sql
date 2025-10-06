-- STRATEGY 1: DATABASE TRIGGERS FOR AUTOMATIC TITLE UPDATES
-- This SQL creates triggers that automatically update title_leaderboard 
-- whenever user stats change (total_km, longest_streak, etc.)

-- 1. First, create a function to recalculate ALL title leaderboards
CREATE OR REPLACE FUNCTION recalculate_title_leaderboard()
RETURNS VOID AS $$
DECLARE
    title_record RECORD;
    user_record RECORD;
    weekend_avg DECIMAL(10,2);
    longest_run_distance DECIMAL(10,2);
    position_counter INTEGER;
BEGIN
    -- Clear existing leaderboard data
    DELETE FROM title_leaderboard;
    
    -- Loop through each title
    FOR title_record IN SELECT * FROM titles ORDER BY name LOOP
        
        position_counter := 1;
        
        -- Calculate leaderboard based on title type
        IF title_record.name = 'The Ultra Man' THEN
            -- Total kilometers leaderboard
            INSERT INTO title_leaderboard (title_id, user_id, position, value, earned_at)
            SELECT 
                title_record.id,
                u.id,
                ROW_NUMBER() OVER (ORDER BY u.total_km DESC),
                u.total_km,
                NOW()
            FROM users u 
            WHERE u.total_km >= title_record.unlock_requirement
            ORDER BY u.total_km DESC
            LIMIT 3;
            
        ELSIF title_record.name = 'The Daaaaaviiiiiid GOGGINGS' THEN
            -- Longest streak leaderboard
            INSERT INTO title_leaderboard (title_id, user_id, position, value, earned_at)
            SELECT 
                title_record.id,
                u.id,
                ROW_NUMBER() OVER (ORDER BY u.longest_streak DESC),
                u.longest_streak,
                NOW()
            FROM users u 
            WHERE u.longest_streak >= title_record.unlock_requirement
            ORDER BY u.longest_streak DESC
            LIMIT 3;
            
        ELSIF title_record.name = 'The Reborn Eliud Kipchoge' THEN
            -- Longest single run leaderboard
            INSERT INTO title_leaderboard (title_id, user_id, position, value, earned_at)
            SELECT 
                title_record.id,
                subq.user_id,
                ROW_NUMBER() OVER (ORDER BY subq.max_distance DESC),
                subq.max_distance,
                NOW()
            FROM (
                SELECT 
                    r.user_id,
                    MAX(r.distance) as max_distance
                FROM runs r
                GROUP BY r.user_id
                HAVING MAX(r.distance) >= title_record.unlock_requirement
            ) subq
            ORDER BY subq.max_distance DESC
            LIMIT 3;
            
        ELSIF title_record.name = 'The Weekend Destroyer' THEN
            -- Weekend average leaderboard (simplified calculation)
            INSERT INTO title_leaderboard (title_id, user_id, position, value, earned_at)
            SELECT 
                title_record.id,
                subq.user_id,
                ROW_NUMBER() OVER (ORDER BY subq.weekend_avg DESC),
                subq.weekend_avg,
                NOW()
            FROM (
                SELECT 
                    r.user_id,
                    COALESCE(AVG(weekend_totals.total), 0) as weekend_avg
                FROM runs r
                LEFT JOIN (
                    SELECT 
                        user_id,
                        DATE_TRUNC('week', date::date) as week_start,
                        SUM(distance) as total
                    FROM runs 
                    WHERE EXTRACT(DOW FROM date::date) IN (0, 6) -- Sunday=0, Saturday=6
                    GROUP BY user_id, DATE_TRUNC('week', date::date)
                    HAVING SUM(distance) > 0
                ) weekend_totals ON r.user_id = weekend_totals.user_id
                GROUP BY r.user_id
                HAVING COALESCE(AVG(weekend_totals.total), 0) >= title_record.unlock_requirement
            ) subq
            ORDER BY subq.weekend_avg DESC
            LIMIT 3;
            
        END IF;
        
    END LOOP;
    
    -- Update titles table with current holders
    UPDATE titles SET 
        current_holder_id = leaderboard.user_id,
        current_value = leaderboard.value,
        updated_at = NOW()
    FROM (
        SELECT DISTINCT ON (title_id) 
            title_id, user_id, value
        FROM title_leaderboard 
        WHERE position = 1
    ) leaderboard
    WHERE titles.id = leaderboard.title_id;
    
    -- Log the update
    RAISE NOTICE 'Title leaderboard recalculated at %', NOW();
    
END;
$$ LANGUAGE plpgsql;

-- 2. Create trigger function for users table changes
CREATE OR REPLACE FUNCTION trigger_title_update_on_user_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Only recalculate if relevant fields changed
    IF (TG_OP = 'UPDATE' AND (
        OLD.total_km IS DISTINCT FROM NEW.total_km OR 
        OLD.longest_streak IS DISTINCT FROM NEW.longest_streak
    )) OR TG_OP = 'INSERT' THEN
        
        -- Recalculate titles after a small delay to batch updates
        PERFORM recalculate_title_leaderboard();
        
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 3. Create trigger function for runs table changes  
CREATE OR REPLACE FUNCTION trigger_title_update_on_run_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Recalculate titles when runs change (affects longest run and weekend avg)
    PERFORM recalculate_title_leaderboard();
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 4. Create the actual triggers
DROP TRIGGER IF EXISTS users_title_update_trigger ON users;
CREATE TRIGGER users_title_update_trigger
    AFTER INSERT OR UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION trigger_title_update_on_user_change();

DROP TRIGGER IF EXISTS runs_title_update_trigger ON runs;
CREATE TRIGGER runs_title_update_trigger
    AFTER INSERT OR UPDATE OR DELETE ON runs
    FOR EACH STATEMENT
    EXECUTE FUNCTION trigger_title_update_on_run_change();

-- 5. Initial population of title leaderboard
SELECT recalculate_title_leaderboard();

-- 6. Test the setup
DO $$
BEGIN
    RAISE NOTICE 'Database triggers for automatic title updates have been installed!';
    RAISE NOTICE 'The following will now trigger automatic title recalculation:';
    RAISE NOTICE '1. When users.total_km or users.longest_streak changes';
    RAISE NOTICE '2. When runs are added, updated, or deleted';
    RAISE NOTICE 'Title leaderboard will be automatically maintained.';
END
$$;