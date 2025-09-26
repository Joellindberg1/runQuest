import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Få current directory för ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Debug paths
const envPath = path.join(__dirname, '../.env');
console.log('📁 Current __dirname:', __dirname);
console.log('📄 Looking for .env at:', envPath);

// Load environment variables från backend .env
const result = dotenv.config({ path: envPath });
console.log('📋 Dotenv result:', result.error || 'Success');
// import authRoutes from './routes/auth';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

console.log('🔧 Environment check:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', PORT);
console.log('SUPABASE_URL present:', !!process.env.SUPABASE_URL);
console.log('JWT_SECRET present:', !!process.env.JWT_SECRET);
// Test explicit localhost binding

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'RunQuest Backend is running' });
});

// API routes will be added here
app.get('/api', (req, res) => {
  res.json({ message: 'RunQuest API v1' });
});

const server = app.listen(PORT, 'localhost', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 API info: http://localhost:${PORT}/api`);
});

server.on('error', (error: any) => {
  console.error('❌ Server error:', error);
});

server.on('listening', () => {
  console.log('✅ Server is actively listening for connections');
});