import { config } from 'dotenv';
import { getSupabaseClient } from './src/config/database.js';

// Load environment variables
config();

const supabase = getSupabaseClient();

console.log('🔄 Installing user totals triggers...');

// Step 1: Create the function
const createFunction = `
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
    
    -- Log the update for debugging
    RAISE NOTICE 'Updated user % totals: XP=%, KM=%, Level=%', 
                 affected_user_id, total_xp_val, total_km_val, current_level_val;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
`;

try {
  console.log('Creating function...');
  const { error: funcError } = await supabase.rpc('exec_sql', { sql_query: createFunction });
  if (funcError) {
    console.error('❌ Function creation error:', funcError);
    process.exit(1);
  }
  console.log('✅ Function created successfully');

  // Step 2: Drop existing triggers
  console.log('Dropping existing triggers...');
  const dropTriggers = [
    'DROP TRIGGER IF EXISTS trigger_update_user_totals_insert ON runs',
    'DROP TRIGGER IF EXISTS trigger_update_user_totals_update ON runs',
    'DROP TRIGGER IF EXISTS trigger_update_user_totals_delete ON runs'
  ];

  for (const dropSql of dropTriggers) {
    const { error } = await supabase.rpc('exec_sql', { sql_query: dropSql });
    if (error) console.log('Note:', error.message);
  }

  // Step 3: Create new triggers
  const triggers = [
    `CREATE TRIGGER trigger_update_user_totals_insert
     AFTER INSERT ON runs
     FOR EACH ROW
     EXECUTE FUNCTION update_user_totals()`,
    
    `CREATE TRIGGER trigger_update_user_totals_update
     AFTER UPDATE ON runs
     FOR EACH ROW
     WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id OR 
           OLD.xp_gained IS DISTINCT FROM NEW.xp_gained OR 
           OLD.distance IS DISTINCT FROM NEW.distance)
     EXECUTE FUNCTION update_user_totals()`,
    
    `CREATE TRIGGER trigger_update_user_totals_delete
     AFTER DELETE ON runs
     FOR EACH ROW
     EXECUTE FUNCTION update_user_totals()`
  ];

  for (let i = 0; i < triggers.length; i++) {
    console.log(`Creating trigger ${i + 1}/3...`);
    const { error } = await supabase.rpc('exec_sql', { sql_query: triggers[i] });
    if (error) {
      console.error(`❌ Trigger ${i + 1} error:`, error);
      process.exit(1);
    }
    console.log(`✅ Trigger ${i + 1} created successfully`);
  }

  console.log('🎉 All triggers installed successfully!');
  console.log('Now user totals will automatically update when runs are added, modified, or deleted.');

} catch (error) {
  console.error('❌ Installation failed:', error);
  process.exit(1);
}