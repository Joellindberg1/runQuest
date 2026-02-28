// 🛡️ Admin Authorization Middleware
import { logger } from '../utils/logger.js';
import { Request, Response, NextFunction } from 'express';
import { getSupabaseClient } from '../config/database.js';

export const requireAdmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = (req as any).user;
    
    if (!user || !user.user_id) {
      logger.info('❌ Admin check: No authenticated user');
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    logger.info(`🔍 Admin check for user: ${user.name}`);
    
    const supabase = getSupabaseClient();
    
    // Check if user has admin privileges in database
    const { data: userData, error } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.user_id)
      .single();

    if (error) {
      logger.error('❌ Error checking admin status:', error.message);
      res.status(500).json({ error: 'Failed to verify admin status' });
      return;
    }

    if (!userData?.is_admin) {
      logger.info(`❌ Access denied: ${user.name} is not admin`);
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    logger.info(`✅ Admin access granted for: ${user.name}`);
    next();
    
  } catch (error) {
    logger.error('❌ Admin middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export default requireAdmin;