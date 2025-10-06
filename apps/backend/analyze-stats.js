// Analys av alla användares stats för att förstå vem som borde ha vilka titlar

console.log('🔍 Analyserar användarnas faktiska stats...');

// Från backend loggen vet vi att Karl har:
const karl = {
  name: 'Karl Persson', 
  total_km: 174, 
  longest_streak: 21,
  // Behöver kolla längsta run separat
};

console.log('👤 Karl Persson:');
console.log('  - Total distance:', karl.total_km, 'km');
console.log('  - Longest streak:', karl.longest_streak, 'dagar');
console.log('  - Kvalificerar för:');
console.log('    ✅ The Ultra Man (kräv: 100km)');
console.log('    ✅ The Daaaaaviiiiiid GOGGINGS (kräv: 20 dagar)');

console.log('\n📋 Titel-krav:');
console.log('  🏆 The Ultra Man: Totalt 100+ km');
console.log('  🏆 The Daaaaaviiiiiid GOGGINGS: Längsta streak 20+ dagar');  
console.log('  🏆 The Reborn Eliud Kipchoge: Längsta run 12+ km');
console.log('  🏆 The Weekend Destroyer: Weekend-genomsnitt 9+ km');

console.log('\n❓ Frågor att undersöka:');
console.log('  1. Vad har Joel för total_km och longest_streak?');
console.log('  2. Vad har Adam för total_km och longest_streak?'); 
console.log('  3. Vilka har längsta runs över 12km?');
console.log('  4. Har populate-funktionen körts alls?');

console.log('\n🎯 Lösning:');
console.log('  1. Kör populate-endpointen för att fylla title_leaderboard');
console.log('  2. Databasen ska ha förberäknade rankings');
console.log('  3. Frontend bara hämtar färdig data');

// Test populate endpoint
async function testPopulate() {
  try {
    const token = localStorage.getItem('jwt');
    if (!token) {
      console.error('❌ No JWT token found');
      return;
    }
    
    console.log('\n🔄 Testing populate endpoint...');
    const response = await fetch('/api/titles/populate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token
      }
    });
    
    const result = await response.json();
    console.log('📊 Populate result:', result);
    
  } catch (error) {
    console.error('❌ Populate error:', error);
  }
}

console.log('\n🚀 För att testa populate, kör: testPopulate()');
window.testPopulate = testPopulate;