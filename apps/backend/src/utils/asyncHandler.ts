// 🛡️ Async Route Handler Wrapper
// Automatically handles async errors and ensures proper TypeScript compliance

import { Request, Response, NextFunction } from 'express';

type AsyncRouteHandler = (
  req: Request, 
  res: Response, 
  next: NextFunction
) => Promise<void | any>;

/**
 * Wraps async route handlers to:
 * 1. Automatically catch and forward errors to Express error middleware
 * 2. Ensure proper TypeScript return type compliance
 * 3. Eliminate "Not all code paths return a value" warnings
 * 
 * @param fn - The async route handler function
 * @returns Express-compatible route handler with proper error handling
 */
export const asyncHandler = (fn: AsyncRouteHandler) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res, next);
    } catch (error) {
      console.error('🚨 Async route error:', error);
      next(error); // Forward to Express error middleware
    }
  };
};

/**
 * Alternative version for middleware that might need to call next()
 */
export const asyncMiddleware = (fn: AsyncRouteHandler) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await fn(req, res, next);
      // If the function doesn't send a response, call next()
      if (!res.headersSent && result === undefined) {
        next();
      }
    } catch (error) {
      console.error('🚨 Async middleware error:', error);
      next(error);
    }
  };
};

export default asyncHandler;