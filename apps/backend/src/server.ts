// 🚀 RunQuest Backend Server — produktions-entrypoint.
// All http-wiring bor i app.ts (createApp, ADR 003); här finns bara det som
// hör till PROCESSEN: env-laddning/validering, listen, schedulers, shutdown.
import { logger } from './utils/logger.js';
import { errorCode } from './utils/errorCode.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { startStravaScheduler } from './scheduler/stravaSync.js';
import { startChallengeScheduler } from './scheduler/challengeScheduler.js';
import { startEventScheduler } from './scheduler/eventScheduler.js';
import { startStreakScheduler } from './scheduler/streakScheduler.js';
import { startStravaWebhookScheduler } from './scheduler/stravaWebhookScheduler.js';
import { startStravaReconcileScheduler } from './scheduler/stravaReconcileScheduler.js';
import { registerStravaRateBudget } from './services/stravaRateBudget.js';
import { reportTokenKeyAtStartup } from './services/tokenKeyStartup.js';
import { flushSentry, initSentry } from './observability/sentry.js';
import { createShutdown, exitAfterFlush } from './utils/shutdown.js';

// 📋 Step 1: Load Environment Variables
logger.info('🔧 Step 1: Loading environment variables...');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from backend directory
dotenv.config({ path: path.join(__dirname, '../.env') });

// Sentry direkt efter env-laddningen, före allt annat som kan fela (utan SENTRY_DSN händer ingenting).
const sentryEnabled = initSentry();
logger.info(sentryEnabled ? `🛰️ Sentry on (environment: ${process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development'})` : 'ℹ️ Sentry off (no SENTRY_DSN)');

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
  await exitAfterFlush(1, { flush: flushSentry, exit: (code) => process.exit(code) });
}

logger.info('✅ Step 1 Complete: Environment loaded successfully\n');

// Rate budget: counts every Strava call for the whole process (ADR 010 decision 9). Registered here, once, before any
// request or scheduler can call Strava; in createApp() it would also leak into every test that builds the app.
registerStravaRateBudget();

// Token key (ADR 013 decision 9): a missing or refused key is a KRITISKT alarm and the Strava track stays off (fail-closed); the process
// goes on, since the rest of the app does not need the key. Called at the top level so that the CI guard (rule 12) can see it.
reportTokenKeyAtStartup();

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

server.on('error', async (error: NodeJS.ErrnoException) => {
  logger.error('❌ Server error:', errorCode(error));
  if (error.code === 'EADDRINUSE') {
    logger.error(`❌ Port ${PORT} is already in use`);
  }
  await exitAfterFlush(1, { flush: flushSentry, exit: (code) => process.exit(code) });
});

server.on('listening', () => {
  logger.info('✅ Server is actively listening for connections\n');

  // 🕐 Schedulers — endast i produktion
  if (process.env.NODE_ENV === 'production') {
    logger.info('🕐 Starting schedulers (production)...');
    startStravaScheduler();
    startChallengeScheduler();
    startEventScheduler();
    startStreakScheduler();
    startStravaWebhookScheduler();
    startStravaReconcileScheduler();
  } else {
    logger.info('ℹ️ Schedulers disabled in development mode');
    logger.info('💡 Use POST /api/strava/sync for manual Strava testing');
  }
});

// Graceful shutdown: SIGTERM är det Railway skickar vid varje deploy, SIGINT är Ctrl+C. Båda skickar köade Sentry-händelser före exit.
const shutdown = createShutdown({
  closeServer: (onClosed) => server.close(() => onClosed()),
  flush: flushSentry,
  exit: (code) => process.exit(code),
  log: (message) => logger.info(message),
  forceExitAfterMs: 10_000,
});
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

export default app;
