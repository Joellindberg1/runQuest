// 🛡️ Admin Authorization Middleware
import { logger } from '../utils/logger.js';
import { Request, Response, NextFunction } from 'express';
import { getSupabaseClient } from '../config/database.js';
import { errorCode } from '../utils/errorCode.js';
import { fail } from '../utils/respond.js';

export const requireAdmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = (req as any).user;
    
    if (!user || !user.user_id) {
      logger.info('❌ Admin check: No authenticated user');
      fail(res, 401, 'Authentication required');
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
      fail(res, 500, 'Failed to verify admin status');
      return;
    }

    if (!userData?.is_admin) {
      logger.info(`❌ Access denied: user_id ${user.user_id} is not admin`);
      fail(res, 403, 'Admin access required', 'admin_required');
      return;
    }

    logger.info(`✅ Admin access granted for user_id: ${user.user_id}`);
    next();
    
  } catch (error) {
    logger.error(`❌ Admin middleware error (${errorCode(error)})`);
    fail(res, 500, 'Internal server error');
  }
};

export default requireAdmin;