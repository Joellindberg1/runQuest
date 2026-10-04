// 🚀 RunQuest Backend Server — produktions-entrypoint.
// All http-wiring bor i app.ts (createApp, ADR 003); här finns bara det som
// hör till PROCESSEN: env-laddning/validering, listen, schedulers, shutdown.
import { logger } from './utils/logger.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { startStravaScheduler } from './scheduler/stravaSync.js';
import { startChallengeScheduler } from './scheduler/challengeScheduler.js';
import { startEventScheduler } from './scheduler/eventScheduler.js';

// 📋 Step 1: Load Environment Variables
logger.info('🔧 Step 1: Loading environment variables...');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from backend directory
dotenv.config({ path: path.join(__dirname, '../.env') });

const requiredEnvVars = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || '3001',
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  JWT_SECRET: process.env.JWT_SECRET
};

logger.info('📊 Environment Status:');
Object.entries(requiredEnvVars).forEach(([key, value]) => {
  const status = value ? '✅' : '❌';
  logger.info(`  ${status} ${key}: ${key.includes('SECRET') || key.includes('KEY') ? (value ? 'set' : 'missing') : (value || 'missing')}`);
});

const missingVars = Object.entries(requiredEnvVars)
  .filter(([key, value]) => !value && key !== 'NODE_ENV')
  .map(([key]) => key);

if (missingVars.length > 0) {
  logger.error('❌ Missing required environment variables:', missingVars);
  process.exit(1);
}

logger.info('✅ Step 1 Complete: Environment loaded successfully\n');

// 📋 Step 2: Create app (måste importeras EFTER dotenv.config — dynamisk import)
logger.info('🔧 Step 2: Creating Express app...');
const { createApp } = await import('./app.js');
const app = createApp();
const PORT = parseInt(requiredEnvVars.PORT);

// 📋 Step 3: Start Server
logger.info('🔧 Step 3: Starting server...');

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info('🚀 Server started successfully!');
  logger.info(`🔗 Running on: http://localhost:${PORT}`);
  logger.info(`🌍 Environment: ${requiredEnvVars.NODE_ENV}`);
});

server.on('error', (error: NodeJS.ErrnoException) => {
  logger.error('❌ Server error:', error.code);
  if (error.code === 'EADDRINUSE') {
    logger.error(`❌ Port ${PORT} is already in use`);
  }
  process.exit(1);
});

server.on('listening', () => {
  logger.info('✅ Server is actively listening for connections\n');

  // 🕐 Schedulers — endast i produktion
  if (process.env.NODE_ENV === 'production') {
    logger.info('🕐 Starting schedulers (production)...');
    startStravaScheduler();
    startChallengeScheduler();
    startEventScheduler();
  } else {
    logger.info('ℹ️ Schedulers disabled in development mode');
    logger.info('💡 Use POST /api/strava/sync for manual Strava testing');
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('\n🔄 Shutting down gracefully...');
  server.close(() => {
    logger.info('✅ Server closed');
    process.exit(0);
  });
});

export default app;
