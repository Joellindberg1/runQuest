// 🔐 JWT Authentication Middleware
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

// Extend Request type to include user
declare module 'express-serve-static-core' {
  interface Request {
    user?: {
      user_id: string;
      name: string;
      email: string;
    };
  }
}

export interface AuthenticatedRequest extends Request {
  user: {
    user_id: string;
    name: string;
    email: string;
  };
}

export const authenticateJWT = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    console.log('❌ No authorization header');
    return res.status(401).json({ error: 'Authorization header required' });
  }
  
  const token = authHeader.split(' ')[1]; // Bearer TOKEN
  
  if (!token) {
    console.log('❌ No token in authorization header');
    return res.status(401).json({ error: 'Token required' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any;
    console.log(`🔐 JWT verified for user: ${decoded.name}`);
    
    req.user = {
      user_id: decoded.user_id,
      name: decoded.name,
      email: decoded.email
    };
    
    next();
  } catch (error) {
    console.error('❌ JWT verification failed:', error);
    return res.status(403).json({ error: 'Invalid token' });
  }
};

export default authenticateJWT;