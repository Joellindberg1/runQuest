// Express app factory — ENDA platsen för http-wiring (ADR 003).
// server.ts startar den i produktion; integrationstester importerar
// default-exporten via supertest/http (ingen listen, ingen process.exit).
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { logger } from './utils/logger.js';

import authRoutes from './routes/auth.js';
import challengeRoutes from './routes/challenges.js';
import eventRoutes from './routes/events.js';
import groupRoutes from './routes/groups.js';
import onboardingRoutes from './routes/onboarding.js';
import stravaRoutes from './routes/strava.js';
import titleRoutes from './routes/titles.js';
import runRoutes from './routes/runs.js';
import userRoutes from './routes/users.js';

export function createApp(): express.Express {
  const app = express();

  // Bakom Railways proxy — krävs för att req.ip ska vara klientens IP
  // (annars delar alla användare proxyns IP i rate limitern)
  app.set('trust proxy', 1);

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

  // Request logging
  app.use((req, _res, next) => {
    logger.info(`📨 ${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'OK',
      message: 'RunQuest Backend is running',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  // API info
  app.get('/api', (_req, res) => {
    res.json({
      message: 'RunQuest API v1.0.0',
      endpoints: {
        health: '/health',
        api: '/api',
        auth: { login: '/api/auth/login', refresh: '/api/auth/refresh' },
        strava: { config: '/api/strava/config', status: '/api/strava/status', callback: '/api/strava/callback' }
      },
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development'
    });
  });

  // Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/challenges', challengeRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/groups', groupRoutes);
  app.use('/api/onboarding', onboardingRoutes);
  app.use('/api/strava', stravaRoutes);
  app.use('/api/titles', titleRoutes);
  app.use('/api/runs', runRoutes);
  app.use('/api/users', userRoutes);

  // 404 handler
  app.use((req, res) => {
    logger.info(`❓ 404 - Route not found: ${req.method} ${req.originalUrl}`);
    res.status(404).json({
      error: 'Route not found',
      path: req.originalUrl,
      method: req.method
    });
  });

  return app;
}

export default createApp();
