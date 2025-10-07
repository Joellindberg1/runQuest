// 🛡️ Admin Authorization Middleware
import { Request, Response, NextFunction } from 'express';
import { getSupabaseClient } from '../config/database.js';

export const requireAdmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = (req as any).user;
    
    if (!user || !user.user_id) {
      console.log('❌ Admin check: No authenticated user');
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    console.log(`🔍 Admin check for user: ${user.name}`);
    
    const supabase = getSupabaseClient();
    
    // Check if user has admin privileges in database
    const { data: userData, error } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.user_id)
      .single();

    if (error) {
      console.error('❌ Error checking admin status:', error.message);
      res.status(500).json({ error: 'Failed to verify admin status' });
      return;
    }

    if (!userData?.is_admin) {
      console.log(`❌ Access denied: ${user.name} is not admin`);
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    console.log(`✅ Admin access granted for: ${user.name}`);
    next();
    
  } catch (error) {
    console.error('❌ Admin middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export default requireAdmin;