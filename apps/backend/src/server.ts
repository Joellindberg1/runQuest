// 🚀 RunQuest Backend Server - Clean Build
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
// 🕐 Import Strava scheduler
import { startStravaScheduler } from './scheduler/stravaSync.js';

// 📋 Step 1: Load Environment Variables
console.log('🔧 Step 1: Loading environment variables...');
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

console.log('📊 Environment Status:');
Object.entries(requiredEnvVars).forEach(([key, value]) => {
  const status = value ? '✅' : '❌';
  const displayValue = key.includes('SECRET') || key.includes('KEY') ? 
    (value ? `${value.substring(0, 10)}...` : 'missing') : 
    (value || 'missing');
  console.log(`  ${status} ${key}: ${displayValue}`);
});

// Check for missing critical env vars
const missingVars = Object.entries(requiredEnvVars)
  .filter(([key, value]) => !value && key !== 'NODE_ENV')
  .map(([key]) => key);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingVars);
  process.exit(1);
}

console.log('✅ Step 1 Complete: Environment loaded successfully\n');

// 📋 Step 2: Initialize Express App
console.log('🔧 Step 2: Initializing Express app...');
const app = express();
const PORT = parseInt(requiredEnvVars.PORT);

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📨 ${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

console.log('✅ Step 2 Complete: Express app initialized\n');

// 📋 Step 3: Define Routes
console.log('🔧 Step 3: Setting up routes...');

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('💚 Health check requested');
  res.json({ 
    status: 'OK', 
    message: 'RunQuest Backend is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API info endpoint
app.get('/api', (req, res) => {
  console.log('📋 API info requested');
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
app.get('/api/database/test', async (req, res) => {
  console.log('🗄️ Database test requested');
  try {
    const result = await testDatabaseConnection();
    res.json(result);
  } catch (error) {
    console.error('❌ Database test error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Database connection failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// 🔐 Auth routes
console.log('🔐 Mounting auth routes...');
app.use('/api/auth', authRoutes);

// 🔗 Strava routes  
console.log('🔗 Mounting Strava routes...');
app.use('/api/strava', stravaRoutes);

// 404 handler
app.use((req, res) => {
  console.log(`❓ 404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method
  });
});

console.log('✅ Step 3 Complete: Routes configured\n');

// 📋 Step 4: Start Server
console.log('🔧 Step 4: Starting server...');
// Updated to listen on all interfaces

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server started successfully!`);
  console.log(`🔗 Running on: http://localhost:${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 API info: http://localhost:${PORT}/api`);
  console.log(`🌍 Environment: ${requiredEnvVars.NODE_ENV}`);
  console.log(`⏰ Started at: ${new Date().toISOString()}`);
  console.log('');
  console.log('🎯 Server is ready for requests!');
});

// Error handling
server.on('error', (error: any) => {
  console.error('❌ Server error:', error.code);
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use`);
    console.log('💡 Try: Get-Process | Where-Object {$_.ProcessName -eq "node"} | Stop-Process -Force');
  }
  process.exit(1);
});

server.on('listening', () => {
  console.log('✅ Step 4 Complete: Server is actively listening for connections\n');
  
  // 🕐 Start Strava sync scheduler
  if (process.env.NODE_ENV === 'production') {
    console.log('🕐 Starting Strava sync scheduler for production...');
    startStravaScheduler();
  } else {
    console.log('ℹ️ Strava scheduler disabled in development mode');
    console.log('💡 Use POST /api/strava/sync for manual testing');
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🔄 Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

export default app;