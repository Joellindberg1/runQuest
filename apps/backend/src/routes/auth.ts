// 🔐 Authentication Routes
import { logger } from '../utils/logger.js';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res): Promise<void> => {
  try {
    logger.info('🔐 Login attempt received');
    const { name, email, password } = req.body;
    const nameOrEmail = name || email;

    if (!nameOrEmail || !password) {
      logger.info('❌ Missing name/email or password');
      res.status(400).json({ error: 'Name/email and password required' }); return;
    }

    logger.info(`🔍 Looking up user: ${nameOrEmail}`);
    
    // Get Supabase client and query users table
    const supabase = getSupabaseClient();
    
    // Find user by email or name in a single query
    const { data: users, error } = await supabase
      .from('users')
      .select('id, name, email, password_hash, is_admin, group_id')
      .or(`email.eq.${nameOrEmail},name.eq.${nameOrEmail}`)
      .limit(1);

    const user = users?.[0] ?? null;

    if (error || !user) {
      logger.info('❌ User not found or database error:', error?.message);
      res.status(401).json({ error: 'Invalid credentials' }); return;
    }

    logger.info(`🔑 User found, verifying password for: ${user.name}`);

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      logger.info('❌ Password mismatch');
      res.status(401).json({ error: 'Invalid credentials' }); return;
    }

    logger.info('✅ Password verified, creating JWT token');

    // Create JWT token with proper typing
    const jwtSecret = process.env.JWT_SECRET;
    const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '7d';
    
    if (!jwtSecret) {
      logger.error('❌ JWT_SECRET not configured');
      res.status(500).json({ error: 'Server configuration error' }); return;
    }

    const token = jwt.sign(
      {
        user_id: user.id,
        name: user.name,
        email: user.email,
        is_admin: user.is_admin || false,
        group_id: user.group_id ?? null
      },
      jwtSecret,
      { 
        expiresIn: jwtExpiresIn
      } as jwt.SignOptions
    );

    logger.info(`🎉 Login successful for user: ${user.name} (Admin: ${user.is_admin})`);

    // Return token and user info
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        is_admin: user.is_admin || false
      }
    });

  } catch (error) {
    logger.error('❌ Login error:', error);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
});

// POST /api/auth/refresh (placeholder for now)
router.post('/refresh', async (_req, res) => {
  logger.info('🔄 Token refresh requested (not implemented yet)');
  res.json({ message: 'Token refresh - to be implemented' });
});

// POST /api/auth/change-password
router.post('/change-password', authenticateJWT, async (req, res): Promise<void> => {
  try {
    logger.info('🔐 Password change attempt received');
    const { currentPassword, newPassword } = req.body;
    const userId = (req as any).user.user_id;

    if (!currentPassword || !newPassword) {
      logger.info('❌ Missing current or new password');
      res.status(400).json({ error: 'Current password and new password required' }); return;
    }

    if (newPassword.length < 6) {
      logger.info('❌ New password too short');
      res.status(400).json({ error: 'New password must be at least 6 characters long' }); return;
    }

    logger.info(`🔍 Looking up user for password change: ${userId}`);
    
    // Get Supabase client and query users table
    const supabase = getSupabaseClient();
    
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, password_hash')
      .eq('id', userId)
      .single();

    if (error || !user) {
      logger.info('❌ User not found or database error:', error?.message);
      res.status(404).json({ error: 'User not found' }); return;
    }

    logger.info(`🔑 User found, verifying current password for: ${user.name}`);

    // Verify current password
    const passwordMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!passwordMatch) {
      logger.info('❌ Current password is incorrect');
      res.status(401).json({ error: 'Current password is incorrect' }); return;
    }

    logger.info('✅ Current password verified, hashing new password');

    // Hash new password
    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password in database
    const { error: updateError } = await supabase
      .from('users')
      .update({ password_hash: newPasswordHash })
      .eq('id', userId);

    if (updateError) {
      logger.info('❌ Error updating password:', updateError.message);
      res.status(500).json({ error: 'Failed to update password' }); return;
    }

    logger.info(`🎉 Password successfully changed for user: ${user.name}`);

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    logger.error('❌ Password change error:', error);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
});

// GET /api/auth/users - Admin only: Get all users in same group
router.get('/users', authenticateJWT, requireAdmin, async (req, res): Promise<void> => {
  try {
    logger.info('👥 Admin request to fetch all users');
    logger.info('🔑 Request user info:', (req as any).user);

    const supabase = getSupabaseClient();
    const groupId = req.user!.group_id;

    let query = supabase
      .from('users')
      .select('id, name, email, total_xp, current_level, total_km, current_streak, longest_streak, created_at')
      .order('created_at', { ascending: true });

    if (groupId) {
      query = query.eq('group_id', groupId);
    }

    const { data: users, error } = await query;

    if (error) {
      logger.info('❌ Error fetching users:', error.message);
      res.status(500).json({ error: 'Failed to fetch users' }); return;
    }

    logger.info(`✅ Successfully fetched ${users?.length || 0} users`);

    res.json({
      success: true,
      data: users
    });

  } catch (error) {
    logger.error('❌ Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
});

// POST /api/auth/users - Admin only: Create new user
router.post('/users', authenticateJWT, requireAdmin, async (req, res): Promise<void> => {
  try {
    logger.info('👤 Admin request to create new user');
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      logger.info('❌ Missing required fields');
      res.status(400).json({ error: 'Name, email, and password are required' }); return;
    }

    if (password.length < 6) {
      logger.info('❌ Password too short');
      res.status(400).json({ error: 'Password must be at least 6 characters long' }); return;
    }

    logger.info(`🔍 Creating user: ${name} (${email})`);
    
    const supabase = getSupabaseClient();
    
    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .or(`name.eq.${name},email.eq.${email}`)
      .single();

    if (existingUser) {
      logger.info('❌ User already exists');
      res.status(409).json({ error: 'User with this name or email already exists' }); return;
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create new user — assign to same group as the admin creating them
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({
        name,
        email,
        password_hash: passwordHash,
        total_xp: 0,
        current_level: 1,
        current_streak: 0,
        longest_streak: 0,
        total_km: 0.0,
        group_id: req.user!.group_id ?? null
      })
      .select('id, name, email, total_xp, current_level, current_streak, created_at')
      .single();

    if (error) {
      logger.info('❌ Error creating user:', error.message);
      res.status(500).json({ error: 'Failed to create user' }); return;
    }

    logger.info(`🎉 Successfully created user: ${newUser.name}`);

    res.json({
      success: true,
      data: newUser
    });

  } catch (error) {
    logger.error('❌ Error creating user:', error);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
});

// PUT /api/auth/users/:id/password - Admin only: Reset user password
router.put('/users/:id/password', authenticateJWT, requireAdmin, async (req, res): Promise<void> => {
  try {
    logger.info('🔐 Admin request to reset user password');
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword) {
      logger.info('❌ Missing new password');
      res.status(400).json({ error: 'New password is required' }); return;
    }

    if (newPassword.length < 6) {
      logger.info('❌ New password too short');
      res.status(400).json({ error: 'New password must be at least 6 characters long' }); return;
    }

    logger.info(`🔍 Resetting password for user ID: ${id}`);
    
    const supabase = getSupabaseClient();
    
    // Verify user exists
    const { data: user, error: findError } = await supabase
      .from('users')
      .select('id, name')
      .eq('id', id)
      .single();

    if (findError || !user) {
      logger.info('❌ User not found:', findError?.message);
      res.status(404).json({ error: 'User not found' }); return;
    }

    logger.info(`✅ User found: ${user.name}, hashing new password`);

    // Hash new password
    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password in database
    const { error: updateError } = await supabase
      .from('users')
      .update({ password_hash: newPasswordHash })
      .eq('id', id);

    if (updateError) {
      logger.info('❌ Error updating password:', updateError.message);
      res.status(500).json({ error: 'Failed to update password' }); return;
    }

    logger.info(`🎉 Password successfully reset for user: ${user.name}`);

    res.json({
      success: true,
      message: 'Password reset successfully'
    });

  } catch (error) {
    logger.error('❌ Password reset error:', error);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
});

/**
 * POST /api/auth/recalculate-totals
 * Recalculate user totals and trigger title system
 */
router.post('/recalculate-totals', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user!.user_id;
    logger.info(`🔄 Recalculating totals for user ${userId}...`);
    
    const { calculateUserTotals } = await import('../utils/calculateUserTotals.js');
    await calculateUserTotals(userId, req.user!.group_id);
    
    res.json({
      success: true,
      message: 'User totals recalculated successfully',
      userId: userId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('❌ Error recalculating user totals:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to recalculate user totals',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/auth/admin-settings - Get admin settings
router.get('/admin-settings', authenticateJWT, requireAdmin, async (_req, res): Promise<void> => {
  try {
    logger.info('🔍 Admin: Fetching admin settings...');
    
    const supabase = getSupabaseClient();
    const { data: settings, error } = await supabase
      .from('admin_settings')
      .select('id, base_xp, xp_per_km, bonus_5km, bonus_10km, bonus_15km, bonus_20km, min_run_distance, streak_multipliers, updated_at')
      .single();
    
    if (error) {
      logger.error('❌ Failed to fetch admin settings:', error);
      res.status(500).json({ error: 'Failed to fetch admin settings' }); return;
    }
    
    logger.info('✅ Admin settings fetched successfully');
    res.json({ success: true, data: settings });
    
  } catch (error) {
    logger.error('❌ Error fetching admin settings:', error);
    res.status(500).json({ error: 'Failed to fetch admin settings' }); return;
  }
});

// PUT /api/auth/admin-settings - Update admin settings
router.put('/admin-settings', authenticateJWT, requireAdmin, async (req, res): Promise<void> => {
  try {
    logger.info('💾 Admin: Updating admin settings...');
    const { 
      base_xp, 
      xp_per_km, 
      bonus_5km, 
      bonus_10km, 
      bonus_15km, 
      bonus_20km, 
      min_run_distance 
    } = req.body;
    
    // Validate required fields
    if (base_xp === undefined || xp_per_km === undefined) {
      res.status(400).json({ error: 'base_xp and xp_per_km are required' }); return;
    }
    
    const supabase = getSupabaseClient();
    
    // Update admin settings
    const { data: updatedSettings, error } = await supabase
      .from('admin_settings')
      .update({
        base_xp,
        xp_per_km,
        bonus_5km: bonus_5km ?? 5,
        bonus_10km: bonus_10km ?? 15,
        bonus_15km: bonus_15km ?? 25,
        bonus_20km: bonus_20km ?? 50,
        min_run_distance: min_run_distance ?? 1.0,
        updated_at: new Date().toISOString()
      })
      .eq('id', 1) // Assuming single settings row with id=1
      .select('id, base_xp, xp_per_km, bonus_5km, bonus_10km, bonus_15km, bonus_20km, min_run_distance, streak_multipliers, updated_at')
      .single();
    
    if (error) {
      logger.error('❌ Failed to update admin settings:', error);
      res.status(500).json({ error: 'Failed to update admin settings' }); return;
    }
    
    logger.info('✅ Admin settings updated successfully');
    res.json({ 
      success: true, 
      data: updatedSettings,
      message: 'Admin settings updated successfully' 
    });
    
  } catch (error) {
    logger.error('❌ Error updating admin settings:', error);
    res.status(500).json({ error: 'Failed to update admin settings' }); return;
  }
});

// GET /api/auth/streak-multipliers - Get streak multipliers
router.get('/streak-multipliers', authenticateJWT, requireAdmin, async (_req, res): Promise<void> => {
  try {
    logger.info('🔍 Admin: Fetching streak multipliers...');
    
    const supabase = getSupabaseClient();
    const { data: multipliers, error } = await supabase
      .from('streak_multipliers')
      .select('id, days, multiplier')
      .order('days');
    
    if (error) {
      logger.error('❌ Failed to fetch streak multipliers:', error);
      res.status(500).json({ error: 'Failed to fetch streak multipliers' }); return;
    }
    
    logger.info('✅ Streak multipliers fetched successfully');
    res.json({ success: true, data: multipliers });
    
  } catch (error) {
    logger.error('❌ Error fetching streak multipliers:', error);
    res.status(500).json({ error: 'Failed to fetch streak multipliers' }); return;
  }
});

// PUT /api/auth/streak-multipliers - Update streak multipliers
router.put('/streak-multipliers', authenticateJWT, requireAdmin, async (req, res): Promise<void> => {
  try {
    logger.info('💾 Admin: Updating streak multipliers...');
    const { multipliers } = req.body;
    
    if (!Array.isArray(multipliers)) {
      res.status(400).json({ error: 'multipliers must be an array' }); return;
    }
    
    const supabase = getSupabaseClient();
    
    // Delete existing multipliers and insert new ones
    await supabase.from('streak_multipliers').delete().neq('id', 0); // Delete all
    
    const { data: insertedMultipliers, error } = await supabase
      .from('streak_multipliers')
      .insert(multipliers)
      .select('id, days, multiplier');
    
    if (error) {
      logger.error('❌ Failed to update streak multipliers:', error);
      res.status(500).json({ error: 'Failed to update streak multipliers' }); return;
    }
    
    logger.info('✅ Streak multipliers updated successfully');
    res.json({ 
      success: true, 
      data: insertedMultipliers,
      message: 'Streak multipliers updated successfully' 
    });
    
  } catch (error) {
    logger.error('❌ Error updating streak multipliers:', error);
    res.status(500).json({ error: 'Failed to update streak multipliers' }); return;
  }
});

// GET /api/auth/users-with-runs - Get all users in same group with their runs
router.get('/users-with-runs', authenticateJWT, async (req, res): Promise<void> => {
  try {
    logger.info('👥 Fetching users with runs');

    const supabase = getSupabaseClient();
    const groupId = req.user!.group_id;

    let query = supabase
      .from('users')
      .select(`
        id, name, total_xp, current_level, total_km,
        current_streak, longest_streak, profile_picture,
        wins, draws, losses, challenge_active,
        runs(id, user_id, date, distance, xp_gained, multiplier,
             streak_day, base_xp, km_xp, distance_bonus, streak_bonus)
      `)
      .order('total_xp', { ascending: false });

    if (groupId) {
      query = query.eq('group_id', groupId);
    }

    const { data: usersWithRuns, error } = await query;

    if (error) {
      logger.error('❌ Error fetching users with runs:', error.message);
      res.status(500).json({ error: 'Failed to fetch users' }); return;
    }

    // Fetch completed challenge counts per tier for each user
    const userIds = (usersWithRuns ?? []).map((u: any) => u.id);
    const challengeCounts: Record<string, { minor: number; major: number; legendary: number }> = {};
    if (userIds.length > 0) {
      const { data: completedChallenges } = await supabase
        .from('challenges')
        .select('tier, challenger_id, opponent_id')
        .in('status', ['completed'])
        .or(`challenger_id.in.(${userIds.join(',')}),opponent_id.in.(${userIds.join(',')})`);

      for (const c of completedChallenges ?? []) {
        const tier = c.tier as 'minor' | 'major' | 'legendary';
        for (const uid of [c.challenger_id, c.opponent_id]) {
          if (!challengeCounts[uid]) challengeCounts[uid] = { minor: 0, major: 0, legendary: 0 };
          challengeCounts[uid][tier]++;
        }
      }
    }

    const data = (usersWithRuns ?? []).map((u: any) => ({
      ...u,
      challenge_counts: challengeCounts[u.id] ?? { minor: 0, major: 0, legendary: 0 },
    }));

    logger.info(`✅ Successfully fetched ${data.length} users with runs`);

    res.json({
      success: true,
      data,
    });

  } catch (error) {
    logger.error('❌ Error fetching users with runs:', error);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
});

export default router;
