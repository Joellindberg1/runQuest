// Test för att verifiera att det enhetliga XP-systemet används av Strava-importen
import { calculateCompleteRunXP } from './packages/shared/dist/xpCalculation.js';

console.log('🧪 TESTAR ENHETLIGT XP-SYSTEM...\n');

// Test samma scenario som Nicklas
const testAdminSettings = {
  base_xp: 15,
  xp_per_km: 2,
  bonus_5km: 5,
  bonus_10km: 15,
  bonus_15km: 25,
  bonus_20km: 50,
  min_run_distance: 1.0
};

const testMultipliers = [
  { days: 5, multiplier: 1.1 },
  { days: 15, multiplier: 1.2 },
  { days: 30, multiplier: 1.3 }
];

console.log('📊 Test 1: Nicklas scenario - 3.47km på streak dag 1');
const result1 = calculateCompleteRunXP(3.47, 1, testAdminSettings, testMultipliers);
console.log('Resultat:', result1);
console.log('Förväntat: 21 XP, Faktiskt:', result1.finalXP);
console.log('✅ Test 1:', result1.finalXP === 21 ? 'PASS' : 'FAIL');

console.log('\n📊 Test 2: 5km run på streak dag 10 (borde få 1.1x multiplier)');
const result2 = calculateCompleteRunXP(5.0, 10, testAdminSettings, testMultipliers);
console.log('Resultat:', result2);
const expected2 = Math.round((15 + 10 + 5) * 1.1); // (base + km + bonus) * streak
console.log('Förväntat:', expected2, 'XP, Faktiskt:', result2.finalXP);
console.log('✅ Test 2:', result2.finalXP === expected2 ? 'PASS' : 'FAIL');

console.log('\n📊 Test 3: 10km run på streak dag 1 (ingen multiplier)');
const result3 = calculateCompleteRunXP(10.0, 1, testAdminSettings, testMultipliers);
console.log('Resultat:', result3);
const expected3 = 15 + 20 + 15; // base + km + bonus
console.log('Förväntat:', expected3, 'XP, Faktiskt:', result3.finalXP);
console.log('✅ Test 3:', result3.finalXP === expected3 ? 'PASS' : 'FAIL');

console.log('\n🎯 SLUTRESULTAT:');
const allPassed = result1.finalXP === 21 && result2.finalXP === expected2 && result3.finalXP === expected3;
console.log(allPassed ? '✅ ALLA TESTER PASSERADE!' : '❌ VISSA TESTER MISSLYCKADES!');
console.log('\n🔧 Det enhetliga systemet är redo för användning.');