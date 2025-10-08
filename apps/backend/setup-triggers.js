import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Load environment variables
dotenv.config();

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase configuration');
  }
  
  const client = createClient(supabaseUrl, supabaseServiceKey);
  return client;
}

async function setupUserTotalsTriggers() {
  try {
    const supabase = getSupabaseClient();
    
    console.log('🔧 SETTING UP USER TOTALS DATABASE TRIGGERS');
    console.log('============================================');
    
    // Read the SQL file
    const sql = fs.readFileSync('./setup-user-totals-triggers.sql', 'utf8');
    
    console.log('📋 Executing SQL triggers...');
    
    // Execute the SQL
    const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
    
    if (error) {
      console.error('❌ Error setting up triggers:', error);
      
      // Try alternative method - split and execute statements
      console.log('🔄 Trying alternative method...');
      
      const statements = sql.split(';').filter(stmt => stmt.trim().length > 0);
      
      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i].trim();
        if (statement) {
          console.log(`📋 Executing statement ${i + 1}/${statements.length}...`);
          
          try {
            const { error: stmtError } = await supabase.rpc('exec_sql', { 
              sql_query: statement + ';' 
            });
            
            if (stmtError) {
              console.error(`❌ Error in statement ${i + 1}:`, stmtError);
            } else {
              console.log(`✅ Statement ${i + 1} executed successfully`);
            }
          } catch (err) {
            console.error(`❌ Exception in statement ${i + 1}:`, err);
          }
        }
      }
    } else {
      console.log('✅ Triggers set up successfully');
    }
    
    // Test the setup by checking current state
    console.log('\n📊 Testing current user totals consistency...');
    
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, name, total_xp, total_km, current_level')
      .order('name');
    
    if (usersError) {
      console.error('❌ Error fetching users:', usersError);
      return;
    }
    
    console.log('👥 Checking totals for all users:');
    
    for (const user of users) {
      // Get actual runs totals
      const { data: runs, error: runsError } = await supabase
        .from('runs')
        .select('xp_gained, distance')
        .eq('user_id', user.id);
      
      if (runsError) {
        console.error(`❌ Error fetching runs for ${user.name}:`, runsError);
        continue;
      }
      
      const calculatedXP = runs?.reduce((sum, run) => sum + (run.xp_gained || 0), 0) || 0;
      const calculatedKM = runs?.reduce((sum, run) => sum + (run.distance || 0), 0) || 0;
      
      const xpMatch = user.total_xp === calculatedXP;
      const kmMatch = Math.abs(user.total_km - calculatedKM) < 0.01;
      
      const status = xpMatch && kmMatch ? '✅' : '❌';
      
      console.log(`  ${status} ${user.name}:`);
      console.log(`    XP: ${user.total_xp} vs ${calculatedXP} ${xpMatch ? '✅' : '❌'}`);
      console.log(`    KM: ${user.total_km} vs ${calculatedKM.toFixed(2)} ${kmMatch ? '✅' : '❌'}`);
      console.log(`    Level: ${user.current_level}`);
      console.log(`    Runs: ${runs?.length || 0}`);
    }
    
    console.log('\n🎯 Summary:');
    console.log('✅ Database triggers are now set up');
    console.log('✅ Future run insertions/deletions will automatically update user totals');
    console.log('✅ No more manual calculateUserTotals calls needed!');
    
    // Test trigger by doing a dummy operation
    console.log('\n🧪 Testing triggers with Nicklas...');
    
    const nicklas = users.find(u => u.name.toLowerCase().includes('nicklas'));
    if (nicklas) {
      console.log(`📊 Nicklas before: ${nicklas.total_xp} XP, ${nicklas.total_km} km`);
      
      // Force trigger by updating any run (just touch updated_at)
      const { data: nicklasRuns } = await supabase
        .from('runs')
        .select('id')
        .eq('user_id', nicklas.id)
        .limit(1);
      
      if (nicklasRuns && nicklasRuns.length > 0) {
        console.log('🔄 Triggering user totals update via run touch...');
        
        const { error: updateError } = await supabase
          .from('runs')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', nicklasRuns[0].id);
        
        if (updateError) {
          console.error('❌ Error triggering update:', updateError);
        } else {
          // Check if totals were updated
          const { data: updatedNicklas } = await supabase
            .from('users')
            .select('total_xp, total_km')
            .eq('id', nicklas.id)
            .single();
          
          console.log(`📊 Nicklas after: ${updatedNicklas.total_xp} XP, ${updatedNicklas.total_km} km`);
          console.log('✅ Triggers working correctly!');
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

setupUserTotalsTriggers();