// 🛡️ Admin Authorization Middleware
import { logger } from '../utils/logger.js';
import { Request, Response, NextFunction } from 'express';
import { getSupabaseClient } from '../config/database.js';
import { errorCode } from '../utils/errorCode.js';

export const requireAdmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = (req as any).user;
    
    if (!user || !user.user_id) {
      logger.info('❌ Admin check: No authenticated user');
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    logger.info(`🔍 Admin check for user_id: ${user.user_id}`);
    
    const supabase = getSupabaseClient();
    
    // Check if user has admin privileges in database
    const { data: userData, error } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.user_id)
      .single();

    if (error) {
      logger.error(`❌ Error checking admin status (${errorCode(error)})`);
      res.status(500).json({ error: 'Failed to verify admin status' });
      return;
    }

    if (!userData?.is_admin) {
      logger.info(`❌ Access denied: user_id ${user.user_id} is not admin`);
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    logger.info(`✅ Admin access granted for user_id: ${user.user_id}`);
    next();
    
  } catch (error) {
    logger.error(`❌ Admin middleware error (${errorCode(error)})`);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export default requireAdmin;