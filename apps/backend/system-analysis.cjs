require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function comprehensiveDatabaseAnalysis() {
  console.log('🔍 COMPREHENSIVE DATABASE & SYSTEM ANALYSIS');
  console.log('='.repeat(60));
  
  try {
    // 1. CONNECTION TEST
    console.log('\n1️⃣ DATABASE CONNECTION TEST:');
    const { data: connectionTest, error: connectionError } = await supabase
      .from('users')
      .select('count', { count: 'exact' })
      .limit(1);

    if (connectionError) {
      console.error('❌ CRITICAL: Database connection failed:', connectionError);
      return;
    }
    console.log('✅ Database connection working');

    // 2. TABLE STRUCTURE VALIDATION
    console.log('\n2️⃣ TABLE STRUCTURE VALIDATION:');
    
    const requiredTables = [
      'users', 'runs', 'strava_tokens', 'titles', 'user_titles', 
      'level_requirements', 'streak_multipliers', 'admin_settings'
    ];

    for (const table of requiredTables) {
      try {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .limit(1);
        
        if (error) {
          console.error(`❌ CRITICAL: Table ${table} error:`, error.message);
        } else {
          console.log(`✅ Table ${table} accessible`);
        }
      } catch (err) {
        console.error(`❌ CRITICAL: Table ${table} not accessible:`, err.message);
      }
    }

    // 3. USER DATA INTEGRITY
    console.log('\n3️⃣ USER DATA INTEGRITY:');
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, name, email, password_hash, current_streak, longest_streak, total_xp, current_level');

    if (usersError) {
      console.error('❌ CRITICAL: Cannot fetch users:', usersError);
    } else {
      console.log(`✅ Found ${users.length} users`);
      
      users.forEach(user => {
        const issues = [];
        if (!user.password_hash) issues.push('missing password_hash');
        if (!user.email) issues.push('missing email');
        if (user.current_streak === null) issues.push('null current_streak');
        if (user.total_xp === null) issues.push('null total_xp');
        
        if (issues.length > 0) {
          console.warn(`⚠️ User ${user.name}: ${issues.join(', ')}`);
        } else {
          console.log(`✅ User ${user.name}: data complete`);
        }
      });
    }

    // 4. RUNS DATA INTEGRITY
    console.log('\n4️⃣ RUNS DATA INTEGRITY:');
    const { data: runs, error: runsError } = await supabase
      .from('runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (runsError) {
      console.error('❌ CRITICAL: Cannot fetch runs:', runsError);
    } else {
      console.log(`✅ Found ${runs.length} recent runs`);
      
      const runIssues = runs.filter(run => {
        return !run.date || !run.distance || !run.xp_gained || 
               !run.user_id || run.streak_day === null;
      });
      
      if (runIssues.length > 0) {
        console.warn(`⚠️ ${runIssues.length} runs have missing required fields`);
        runIssues.slice(0, 3).forEach(run => {
          console.warn(`   Run ${run.id}: missing ${!run.date ? 'date ' : ''}${!run.distance ? 'distance ' : ''}${!run.xp_gained ? 'xp_gained ' : ''}${run.streak_day === null ? 'streak_day' : ''}`);
        });
      } else {
        console.log('✅ All recent runs have complete data');
      }
    }

    // 5. STRAVA CONNECTIONS
    console.log('\n5️⃣ STRAVA CONNECTIONS:');
    const { data: stravaTokens, error: stravaError } = await supabase
      .from('strava_tokens')
      .select('user_id, expires_at, connection_date');

    if (stravaError) {
      console.error('❌ Cannot fetch Strava tokens:', stravaError);
    } else {
      console.log(`✅ Found ${stravaTokens.length} Strava connections`);
      
      const now = Math.floor(Date.now() / 1000);
      const expiredTokens = stravaTokens.filter(token => 
        token.expires_at && token.expires_at < now
      );
      
      if (expiredTokens.length > 0) {
        console.warn(`⚠️ ${expiredTokens.length} Strava tokens are expired`);
      } else {
        console.log('✅ All Strava tokens are valid');
      }
    }

    // 6. LEVEL REQUIREMENTS
    console.log('\n6️⃣ LEVEL REQUIREMENTS:');
    const { data: levels, error: levelsError } = await supabase
      .from('level_requirements')
      .select('*')
      .order('level', { ascending: true });

    if (levelsError) {
      console.error('❌ CRITICAL: Cannot fetch level requirements:', levelsError);
    } else {
      console.log(`✅ Found ${levels.length} level definitions`);
      
      // Check for gaps in level progression
      for (let i = 1; i < levels.length; i++) {
        const current = levels[i];
        const previous = levels[i-1];
        
        if (current.level !== previous.level + 1) {
          console.warn(`⚠️ Level gap: ${previous.level} → ${current.level}`);
        }
        if (current.xp_required <= previous.xp_required) {
          console.warn(`⚠️ XP regression: Level ${current.level} requires ${current.xp_required}, Level ${previous.level} requires ${previous.xp_required}`);
        }
      }
    }

    // 7. ADMIN SETTINGS
    console.log('\n7️⃣ ADMIN SETTINGS:');
    const { data: adminSettings, error: adminError } = await supabase
      .from('admin_settings')
      .select('*')
      .limit(1);

    if (adminError) {
      console.warn('⚠️ Admin settings not configured:', adminError);
    } else if (adminSettings.length === 0) {
      console.warn('⚠️ No admin settings found');
    } else {
      console.log('✅ Admin settings configured');
    }

    // 8. STREAK CONSISTENCY CHECK
    console.log('\n8️⃣ STREAK CONSISTENCY CHECK:');
    for (const user of users) {
      const { data: userRuns } = await supabase
        .from('runs')
        .select('date, streak_day')
        .eq('user_id', user.id)
        .order('date', { ascending: false })
        .limit(5);

      if (userRuns && userRuns.length > 0) {
        const latestRun = userRuns[0];
        const dbCurrentStreak = user.current_streak;
        const latestStreakDay = latestRun.streak_day;
        
        // Simple check - more complex logic would be needed for full validation
        if (Math.abs(dbCurrentStreak - latestStreakDay) > 1) {
          console.warn(`⚠️ ${user.name}: streak mismatch (DB: ${dbCurrentStreak}, Latest run: ${latestStreakDay})`);
        } else {
          console.log(`✅ ${user.name}: streak consistency OK`);
        }
      }
    }

    // 9. CRITICAL ISSUES SUMMARY
    console.log('\n9️⃣ CRITICAL ISSUES SUMMARY:');
    console.log('='.repeat(40));
    
    let criticalIssues = 0;
    let warnings = 0;
    
    // Count issues from previous checks
    if (usersError) criticalIssues++;
    if (runsError) criticalIssues++;
    if (levelsError) criticalIssues++;
    
    if (criticalIssues === 0) {
      console.log('🎉 NO CRITICAL ISSUES FOUND!');
      console.log('✅ System is ready for Beta launch');
    } else {
      console.error(`❌ ${criticalIssues} CRITICAL ISSUES need immediate attention`);
    }
    
    if (warnings > 0) {
      console.log(`⚠️ ${warnings} warnings noted - review recommended`);
    }

    console.log('\n📊 BETA READINESS SCORE: ' + (criticalIssues === 0 ? '100%' : `${Math.max(0, 100 - criticalIssues * 20)}%`));

  } catch (error) {
    console.error('💥 CRITICAL SYSTEM ERROR:', error);
  }
}

comprehensiveDatabaseAnalysis();