// 🔐 JWT Authentication Middleware
import { logger } from '../utils/logger.js';
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

// Extend Request type to include user
declare module 'express-serve-static-core' {
  interface Request {
    user?: {
      user_id: string;
      name: string;
      email: string;
      group_id?: string;
    };
  }
}

export interface AuthenticatedRequest extends Request {
  user: {
    user_id: string;
    name: string;
    email: string;
    group_id?: string;
  };
}

export const authenticateJWT = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    logger.info('❌ No authorization header');
    res.status(401).json({ error: 'Authorization header required' });
    return;
  }

  const token = authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    logger.info('❌ No token in authorization header');
    res.status(401).json({ error: 'Token required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any;
    logger.info(`🔐 JWT verified for user: ${decoded.name}`);

    req.user = {
      user_id: decoded.user_id,
      name: decoded.name,
      email: decoded.email,
      group_id: decoded.group_id ?? undefined
    };

    next();
  } catch (error) {
    logger.error('❌ JWT verification failed:', error);
    res.status(403).json({ error: 'Invalid token' });
  }
};

export default authenticateJWT;