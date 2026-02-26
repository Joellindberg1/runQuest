// Express app factory — imported by server.ts to start the real server
// and by integration tests via supertest (no listen, no process.exit).
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import authRoutes from './routes/auth.js';
import stravaRoutes from './routes/strava.js';
import titleRoutes from './routes/titles.js';
import runRoutes from './routes/runs.js';

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

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
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/strava', stravaRoutes);
app.use('/api/titles', titleRoutes);
app.use('/api/runs', runRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method
  });
});

export default app;
