// 🔐 JWT Authentication Middleware
import { logger } from '../utils/logger.js';
import { withSentryUser } from '../observability/sentry.js';
import { errorCode } from '../utils/errorCode.js';
import { fail } from '../utils/respond.js';
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

export const authenticateJWT = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    logger.info('❌ No authorization header');
    fail(res, 401, 'Authorization header required');
    return;
  }

  const token = authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    logger.info('❌ No token in authorization header');
    fail(res, 401, 'Token required');
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any;
    logger.info(`🔐 JWT verified for user_id: ${decoded.user_id}`);

    req.user = {
      user_id: decoded.user_id,
      name: decoded.name,
      email: decoded.email,
      group_id: decoded.group_id ?? undefined
    };

    // Resten av förfrågan körs i en egen Sentry-scope med bara user_id (se withSentryUser).
    withSentryUser(decoded.user_id, () => next());
  } catch (error) {
    // En ogiltig eller utgången token är klientens fel (401) och ska inte bli en Sentry-händelse: logger.warn når aldrig Sentry.
    // Bara felkoden loggas (jsonwebtoken-felets namn), aldrig felobjektet. Allt annat som kastas här (t.ex. ett fel i en handler
    // som next() kör) är vårt eget fel och loggas som error.
    const message = `❌ JWT verification failed (${errorCode(error)})`;
    if (error instanceof jwt.JsonWebTokenError) logger.warn(message);
    else logger.error(message);
    // Ogiltig/utgången token är AUTENTISERING (401), inte auktorisering — klienten loggar ut vid 401.
    // IDOR-/ägarskaps-403:orna i routes är en annan sak och oförändrade.
    fail(res, 401, 'Invalid token', 'token_invalid');
  }
};

export default authenticateJWT;