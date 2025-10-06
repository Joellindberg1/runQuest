// Demonstration av olika async strategier för Strava import

// 🎯 STRATEGI 1: SEQUENTIAL (Vad vi använder nu)
// Asynkront men en activity i taget
async function processSequential(activities) {
  for (const activity of activities) {
    const xpResult = await calculateRunXP(distance);     // Async, väntar
    const streakResult = await calculateStreak(userId);  // Async, väntar  
    const saved = await saveToDatabase(runData);         // Async, väntar
  }
  // ✅ Garanterad ordning, säker, lätt att debugga
  // ❌ Lite långsammare vid många activities
}

// 🚀 STRATEGI 2: PARALLEL CALCULATIONS (Optimering)
// Kör beräkningar parallellt, sparar sekventiellt
async function processWithParallelCalculations(activities) {
  for (const activity of activities) {
    // Kör beräkningar parallellt (snabbare)
    const [xpResult, streakResult, multipliers] = await Promise.all([
      calculateRunXP(distance),           // ← Dessa körs samtidigt
      calculateStreak(userId, date),      // ← 
      getStreakMultipliers()             // ←
    ]);
    
    // Spara sekventiellt (säkert)
    const saved = await saveToDatabase(runData);
  }
  // ✅ Snabbare beräkningar, fortfarande säker save
  // ❌ Mer komplex error handling
}

// 🔥 STRATEGI 3: CONTROLLED CONCURRENCY (Framtida optimering)  
// Processar flera activities samtidigt (men inte alla)
async function processWithConcurrency(activities, maxConcurrent = 3) {
  const chunks = chunkArray(activities, maxConcurrent);
  
  for (const chunk of chunks) {
    // Processar 3 activities parallellt
    const results = await Promise.allSettled(
      chunk.map(activity => processOneActivity(activity))
    );
    
    // Hantera resultat och errors från chunk
    handleChunkResults(results);
  }
  // ✅ Balans mellan hastighet och stabilitet
  // ❌ Mest komplex implementation
}

// 🎯 VAD VI VALDE: SEQUENTIAL för maximum reliability
export async function currentImplementation() {
  console.log('🔄 Processing activities sequentially for maximum reliability...');
  
  for (const activity of activities) {
    try {
      // ASYNC men med garanterad ordning
      console.log(`📊 Starting async calculations for activity ${activity.id}...`);
      
      const xpResult = await calculateRunXP(distance);
      console.log(`  ✅ XP calculated asynchronously: ${xpResult.totalXP}`);
      
      const streakResult = await StreakService.calculateUserStreaks(userId, date);  
      console.log(`  ✅ Streak calculated asynchronously: Day ${streakResult.streakDayForRun}`);
      
      const multipliers = await supabase.from('streak_multipliers').select();
      console.log(`  ✅ Multipliers loaded asynchronously: ${multipliers.data?.length} tiers`);
      
      // Validate BEFORE saving
      if (finalXP <= 0) {
        throw new Error('XP calculation failed - stopping before save');
      }
      
      const savedRun = await supabase.from('runs').insert(runData).select().single();
      console.log(`  ✅ Data saved asynchronously with ID: ${savedRun.id}`);
      
      // Verify integrity
      if (savedRun.xp_gained !== finalXP) {
        throw new Error('Data integrity check failed');
      }
      
      console.log(`✅ Activity ${activity.id} completed successfully (fully async)`);
      
    } catch (error) {
      console.error(`❌ Activity ${activity.id} failed:`, error);
      // Fail fast - don't continue with corrupted data
      throw error;
    }
  }
}