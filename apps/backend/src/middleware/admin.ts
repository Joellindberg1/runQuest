// 🛡️ Admin Authorization Middleware
import { Request, Response, NextFunction } from 'express';
import { getSupabaseClient } from '../config/database.js';

export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    
    if (!user || !user.user_id) {
      console.log('❌ Admin check: No authenticated user');
      return res.status(401).json({ error: 'Authentication required' });
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
      return res.status(500).json({ error: 'Failed to verify admin status' });
    }

    if (!userData?.is_admin) {
      console.log(`❌ Access denied: ${user.name} is not admin`);
      return res.status(403).json({ error: 'Admin access required' });
    }

    console.log(`✅ Admin access granted for: ${user.name}`);
    next();
    
  } catch (error) {
    console.error('❌ Admin middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export default requireAdmin;