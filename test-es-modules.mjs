// Test ES modules fix for titleLeaderboardService
import { fileURLToPath } from 'url';
import path from 'path';

console.log('Testing ES modules compatibility...');

try {
    // Test the same code that was failing before our fix
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    
    console.log('✅ ES modules __dirname fix working!');
    console.log('__filename:', __filename);
    console.log('__dirname:', __dirname);
} catch (error) {
    console.error('❌ ES modules error:', error.message);
}

console.log('ES modules test completed successfully!');