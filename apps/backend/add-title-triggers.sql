-- Add automatic title leaderboard updates
-- This SQL script creates triggers that automatically update title rankings 
-- when user data changes (runs added/removed/edited)

-- 1. Create function to recalculate ALL title leaderboards
CREATE OR REPLACE FUNCTION recalculate_all_title_leaderboards()
RETURNS VOID AS $$
DECLARE
    title_record RECORD;
    user_record RECORD;
    weekend_avg DECIMAL(10,2);
    longest_run_distance DECIMAL(10,2);
    candidates_data JSON[];
    candidate_record JSON;
    position_counter INTEGER;
BEGIN
    -- Clear all existing leaderboard data
    DELETE FROM title_leaderboard;
    
    -- Loop through each title
    FOR title_record IN SELECT * FROM titles LOOP
        
        -- Reset for each title
        candidates_data := ARRAY[]::JSON[];
        
        -- Calculate candidates based on title type
        FOR user_record IN SELECT id, name, total_km, longest_streak FROM users LOOP
            
            IF title_record.name = 'The Ultra Man' THEN
                -- Total kilometers
                IF (user_record.total_km >= title_record.unlock_requirement) THEN
                    candidates_data := candidates_data || json_build_object(
                        'user_id', user_record.id,
                        'name', user_record.name,
                        'value', user_record.total_km
                    );
                END IF;
                
            ELSIF title_record.name = 'The Daaaaaviiiiiid GOGGINGS' THEN
                -- Longest streak
                IF (user_record.longest_streak >= title_record.unlock_requirement) THEN
                    candidates_data := candidates_data || json_build_object(
                        'user_id', user_record.id,
                        'name', user_record.name,
                        'value', user_record.longest_streak
                    );
                END IF;
                
            ELSIF title_record.name = 'The Reborn Eliud Kipchoge' THEN
                -- Longest single run
                SELECT COALESCE(MAX(distance), 0) INTO longest_run_distance
                FROM runs WHERE user_id = user_record.id;
                
                IF (longest_run_distance >= title_record.unlock_requirement) THEN
                    candidates_data := candidates_data || json_build_object(
                        'user_id', user_record.id,
                        'name', user_record.name,
                        'value', longest_run_distance
                    );
                END IF;
                
            ELSIF title_record.name = 'The Weekend Destroyer' THEN
                -- Weekend average (simplified calculation in SQL)
                WITH weekend_runs AS (
                    SELECT 
                        DATE_TRUNC('week', date::date) as week_start,
                        SUM(distance) as weekend_total
                    FROM runs 
                    WHERE user_id = user_record.id 
                    AND EXTRACT(DOW FROM date::date) IN (0, 6) -- Sunday=0, Saturday=6
                    GROUP BY DATE_TRUNC('week', date::date)
                    HAVING SUM(distance) > 0
                )
                SELECT COALESCE(AVG(weekend_total), 0) INTO weekend_avg FROM weekend_runs;
                
                IF (weekend_avg >= title_record.unlock_requirement) THEN
                    candidates_data := candidates_data || json_build_object(
                        'user_id', user_record.id,
                        'name', user_record.name,
                        'value', weekend_avg
                    );
                END IF;
            END IF;
        END LOOP;
        
        -- Sort candidates by value (descending) and insert top 3
        position_counter := 1;
        FOR candidate_record IN 
            SELECT * FROM jsonb_array_elements(candidates_data::jsonb) 
            ORDER BY (value->>'value')::decimal DESC
            LIMIT 3
        LOOP
            INSERT INTO title_leaderboard (
                title_id, 
                user_id, 
                position, 
                value, 
                earned_at
            ) VALUES (
                title_record.id,
                (candidate_record->>'user_id')::uuid,
                position_counter,
                (candidate_record->>'value')::decimal,
                NOW()
            );
            
            position_counter := position_counter + 1;
        END LOOP;
        
    END LOOP;
    
    -- Update titles table timestamp
    UPDATE titles SET updated_at = NOW();
    
    RAISE NOTICE 'All title leaderboards recalculated successfully';
END;
$$ LANGUAGE plpgsql;

-- 2. Create trigger function for when runs change
CREATE OR REPLACE FUNCTION trigger_recalculate_titles()
RETURNS TRIGGER AS $$
BEGIN
    -- Recalculate all titles when runs data changes
    PERFORM recalculate_all_title_leaderboards();
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 3. Create trigger function for when user stats change
CREATE OR REPLACE FUNCTION trigger_recalculate_titles_user()
RETURNS TRIGGER AS $$
BEGIN
    -- Only recalculate if relevant fields changed
    IF (OLD.total_km IS DISTINCT FROM NEW.total_km) OR 
       (OLD.longest_streak IS DISTINCT FROM NEW.longest_streak) THEN
        PERFORM recalculate_all_title_leaderboards();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Create triggers on runs table
DROP TRIGGER IF EXISTS trigger_runs_insert_update_delete ON runs;
CREATE TRIGGER trigger_runs_insert_update_delete
    AFTER INSERT OR UPDATE OR DELETE ON runs
    FOR EACH STATEMENT
    EXECUTE FUNCTION trigger_recalculate_titles();

-- 5. Create triggers on users table 
DROP TRIGGER IF EXISTS trigger_users_stats_update ON users;
CREATE TRIGGER trigger_users_stats_update
    AFTER UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION trigger_recalculate_titles_user();

-- 6. Initial population
SELECT recalculate_all_title_leaderboards();

-- 7. Grant permissions (if needed)
-- GRANT EXECUTE ON FUNCTION recalculate_all_title_leaderboards() TO authenticated;
-- GRANT EXECUTE ON FUNCTION trigger_recalculate_titles() TO authenticated;
-- GRANT EXECUTE ON FUNCTION trigger_recalculate_titles_user() TO authenticated;