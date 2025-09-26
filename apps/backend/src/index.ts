import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

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

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});