// Enkel in-memory rate limiter (bugg #11: ingen rate limiting på login).
// Appen kör som EN replika (Railway multiRegionConfig: numReplicas 1), så
// in-memory räcker; vid fler repliker krävs delad lagring — ta det då.
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

interface Entry { count: number; resetAt: number }

const attempts = new Map<string, Entry>();
const MAX_TRACKED = 5000;

export function rateLimiter(windowMs: number, max: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    // Hindra obegränsad tillväxt: rensa utgångna poster när kartan blir stor
    if (attempts.size > MAX_TRACKED) {
      for (const [k, e] of attempts) {
        if (e.resetAt <= now) attempts.delete(k);
      }
    }

    const entry = attempts.get(key);
    if (!entry || entry.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    entry.count++;
    if (entry.count > max) {
      logger.warn(`🚦 Rate limit: ${key} blockerad (${entry.count} försök)`);
      res.status(429).json({ error: 'Too many attempts, try again later' });
      return;
    }
    next();
  };
}

/** 20 försök per 15 minuter och IP — bromsar lösenordsgissning utan att störa riktiga användare. */
export const loginRateLimiter = rateLimiter(15 * 60 * 1000, 20);
