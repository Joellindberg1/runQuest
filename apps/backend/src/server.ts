// 🚀 RunQuest Backend Server - Clean Build
import { logger } from './utils/logger.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
// 🗄️ Import database
import { testDatabaseConnection } from './config/database.js';
// 🔐 Import auth routes
import authRoutes from './routes/auth.js';
// 🔗 Import Strava routes
import stravaRoutes from './routes/strava.js';
// 🏆 Import title routes
import titleRoutes from './routes/titles.js';
// 🏃 Import run routes
import runRoutes from './routes/runs.js';
// 👥 Import group routes
import groupRoutes from './routes/groups.js';
// ⚔️ Import challenge routes
import challengeRoutes from './routes/challenges.js';
// 📅 Import event routes
import eventRoutes from './routes/events.js';
// 🕐 Import schedulers
import { startStravaScheduler } from './scheduler/stravaSync.js';
import { startChallengeScheduler } from './scheduler/challengeScheduler.js';
import { startEventScheduler } from './scheduler/eventScheduler.js';

// 📋 Step 1: Load Environment Variables
logger.info('🔧 Step 1: Loading environment variables...');
import { fileURLToPath } from 'url';
import path from 'path';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from backend directory
dotenv.config({ path: path.join(__dirname, '../.env') });

// Environment validation with detailed logging
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
  const displayValue = key.includes('SECRET') || key.includes('KEY') ? 
    (value ? `${value.substring(0, 10)}...` : 'missing') : 
    (value || 'missing');
  logger.info(`  ${status} ${key}: ${displayValue}`);
});

// Check for missing critical env vars
const missingVars = Object.entries(requiredEnvVars)
  .filter(([key, value]) => !value && key !== 'NODE_ENV')
  .map(([key]) => key);

if (missingVars.length > 0) {
  logger.error('❌ Missing required environment variables:', missingVars);
  process.exit(1);
}

logger.info('✅ Step 1 Complete: Environment loaded successfully\n');

// 📋 Step 2: Initialize Express App
logger.info('🔧 Step 2: Initializing Express app...');
const app = express();
const PORT = parseInt(requiredEnvVars.PORT);

// Middleware
app.use(helmet());

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : ['https://www.runquest.dev'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(null, false);
  },
  credentials: true,
}));

app.use(express.json());

// Request logging middleware
app.use((req, _res, next) => {
  logger.info(`📨 ${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

logger.info('✅ Step 2 Complete: Express app initialized\n');

// 📋 Step 3: Define Routes
logger.info('🔧 Step 3: Setting up routes...');

// Health check endpoint
app.get('/health', (_req, res) => {
  logger.info('💚 Health check requested');
  res.json({ 
    status: 'OK', 
    message: 'RunQuest Backend is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API info endpoint
app.get('/api', (_req, res) => {
  logger.info('📋 API info requested');
  res.json({ 
    message: 'RunQuest API v1.0.0',
    endpoints: {
      health: '/health',
      api: '/api',
      database: '/api/database/test',
      auth: {
        login: '/api/auth/login',
        refresh: '/api/auth/refresh'
      },
      strava: {
        config: '/api/strava/config',
        status: '/api/strava/status',
        callback: '/api/strava/callback'
      }
    },
    version: '1.0.0',
    environment: requiredEnvVars.NODE_ENV
  });
});

// Database test endpoint
app.get('/api/database/test', async (_req, res) => {
  logger.info('🗄️ Database test requested');
  try {
    const result = await testDatabaseConnection();
    res.json(result);
  } catch (error) {
    logger.error('❌ Database test error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Database connection failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// 🔐 Auth routes
logger.info('🔐 Mounting auth routes...');
app.use('/api/auth', authRoutes);

// 🔗 Strava routes  
logger.info('🔗 Mounting Strava routes...');
app.use('/api/strava', stravaRoutes);

// 🏆 Title routes
logger.info('🏆 Mounting title routes...');
app.use('/api/titles', titleRoutes);

// 🏃 Run routes
logger.info('🏃 Mounting run routes...');
app.use('/api/runs', runRoutes);

// 👥 Group routes
logger.info('👥 Mounting group routes...');
app.use('/api/groups', groupRoutes);

// ⚔️ Challenge routes
logger.info('⚔️ Mounting challenge routes...');
app.use('/api/challenges', challengeRoutes);

// 📅 Event routes
logger.info('📅 Mounting event routes...');
app.use('/api/events', eventRoutes);

// 404 handler
app.use((req, res) => {
  logger.info(`❓ 404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method
  });
});

logger.info('✅ Step 3 Complete: Routes configured\n');

// 📋 Step 4: Start Server
logger.info('🔧 Step 4: Starting server...');
// Updated to listen on all interfaces

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Server started successfully!`);
  logger.info(`🔗 Running on: http://localhost:${PORT}`);
  logger.info(`🔗 Health check: http://localhost:${PORT}/health`);
  logger.info(`🔗 API info: http://localhost:${PORT}/api`);
  logger.info(`🌍 Environment: ${requiredEnvVars.NODE_ENV}`);
  logger.info(`⏰ Started at: ${new Date().toISOString()}`);
  logger.info('');
  logger.info('🎯 Server is ready for requests!');
});

// Error handling
server.on('error', (error: any) => {
  logger.error('❌ Server error:', error.code);
  if (error.code === 'EADDRINUSE') {
    logger.error(`❌ Port ${PORT} is already in use`);
    logger.info('💡 Try: Get-Process | Where-Object {$_.ProcessName -eq "node"} | Stop-Process -Force');
  }
  process.exit(1);
});

server.on('listening', () => {
  logger.info('✅ Step 4 Complete: Server is actively listening for connections\n');
  
  // 🕐 Start schedulers
  if (process.env.NODE_ENV === 'production') {
    logger.info('🕐 Starting Strava sync scheduler for production...');
    startStravaScheduler();
    logger.info('⚔️ Starting challenge scheduler for production...');
    startChallengeScheduler();
    logger.info('📅 Starting event scheduler for production...');
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