// 🔐 Authentication Routes
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
    console.log('🔐 Login attempt received');
    const { name, email, password } = req.body;
    const nameOrEmail = name || email;

    if (!nameOrEmail || !password) {
      console.log('❌ Missing name/email or password');
      res.status(400).json({ error: 'Name/email and password required' }); return;
      return;
    }

    console.log(`🔍 Looking up user: ${nameOrEmail}`);
    
    // Get Supabase client and query users table
    const supabase = getSupabaseClient();
    
    // Try to find user by email first, then by name
    let { data: user, error } = await supabase
      .from('users')
      .select('id, name, email, password_hash, is_admin')
      .eq('email', nameOrEmail)
      .single();
    
    // If not found by email, try by name
    if (error || !user) {
      const { data: userByName, error: errorByName } = await supabase
        .from('users')
        .select('id, name, email, password_hash, is_admin')
        .eq('name', nameOrEmail)
        .single();
      
      user = userByName;
      error = errorByName;
    }

    if (error || !user) {
      console.log('❌ User not found or database error:', error?.message);
      res.status(401).json({ error: 'Invalid credentials' }); return;
      return;
    }

    console.log(`🔑 User found, verifying password for: ${user.name}`);

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      console.log('❌ Password mismatch');
      res.status(401).json({ error: 'Invalid credentials' }); return;
    }

    console.log('✅ Password verified, creating JWT token');

    // Create JWT token with proper typing
    const jwtSecret = process.env.JWT_SECRET;
    const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '7d';
    
    if (!jwtSecret) {
      console.error('❌ JWT_SECRET not configured');
      res.status(500).json({ error: 'Server configuration error' }); return;
    }

    const token = jwt.sign(
      {
        user_id: user.id,
        name: user.name,
        email: user.email,
        is_admin: user.is_admin || false
      },
      jwtSecret,
      { 
        expiresIn: jwtExpiresIn
      } as jwt.SignOptions
    );

    console.log(`🎉 Login successful for user: ${user.name} (Admin: ${user.is_admin})`);

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
    console.error('❌ Login error:', error);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
});

// POST /api/auth/refresh (placeholder for now)
router.post('/refresh', async (_req, res) => {
  console.log('🔄 Token refresh requested (not implemented yet)');
  res.json({ message: 'Token refresh - to be implemented' });
});

// POST /api/auth/change-password
router.post('/change-password', authenticateJWT, async (req, res): Promise<void> => {
  try {
    console.log('🔐 Password change attempt received');
    const { currentPassword, newPassword } = req.body;
    const userId = (req as any).user.user_id;

    if (!currentPassword || !newPassword) {
      console.log('❌ Missing current or new password');
      res.status(400).json({ error: 'Current password and new password required' }); return;
      return;
    }

    if (newPassword.length < 6) {
      console.log('❌ New password too short');
      res.status(400).json({ error: 'New password must be at least 6 characters long' }); return;
      return;
    }

    console.log(`🔍 Looking up user for password change: ${userId}`);
    
    // Get Supabase client and query users table
    const supabase = getSupabaseClient();
    
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, password_hash')
      .eq('id', userId)
      .single();

    if (error || !user) {
      console.log('❌ User not found or database error:', error?.message);
      res.status(404).json({ error: 'User not found' }); return;
    }

    console.log(`🔑 User found, verifying current password for: ${user.name}`);

    // Verify current password
    const passwordMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!passwordMatch) {
      console.log('❌ Current password is incorrect');
      res.status(401).json({ error: 'Current password is incorrect' }); return;
    }

    console.log('✅ Current password verified, hashing new password');

    // Hash new password
    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password in database
    const { error: updateError } = await supabase
      .from('users')
      .update({ password_hash: newPasswordHash })
      .eq('id', userId);

    if (updateError) {
      console.log('❌ Error updating password:', updateError.message);
      res.status(500).json({ error: 'Failed to update password' }); return;
    }

    console.log(`🎉 Password successfully changed for user: ${user.name}`);

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('❌ Password change error:', error);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
});

// GET /api/auth/users - Admin only: Get all users
router.get('/users', authenticateJWT, requireAdmin, async (req, res): Promise<void> => {
  try {
    console.log('👥 Admin request to fetch all users');
    console.log('🔑 Request user info:', (req as any).user);
    
    const supabase = getSupabaseClient();
    
    const { data: users, error } = await supabase
      .from('users')
      .select('id, name, email, total_xp, current_level, total_km, current_streak, longest_streak, created_at')
      .order('created_at', { ascending: true });

    if (error) {
      console.log('❌ Error fetching users:', error.message);
      res.status(500).json({ error: 'Failed to fetch users' }); return;
    }

    console.log(`✅ Successfully fetched ${users?.length || 0} users`);
    console.log('📊 User data sample:', users?.slice(0, 2));

    res.json({
      success: true,
      data: users
    });

  } catch (error) {
    console.error('❌ Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
});

// POST /api/auth/users - Admin only: Create new user
router.post('/users', authenticateJWT, requireAdmin, async (req, res): Promise<void> => {
  try {
    console.log('👤 Admin request to create new user');
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      console.log('❌ Missing required fields');
      res.status(400).json({ error: 'Name, email, and password are required' }); return;
    }

    if (password.length < 6) {
      console.log('❌ Password too short');
      res.status(400).json({ error: 'Password must be at least 6 characters long' }); return;
    }

    console.log(`🔍 Creating user: ${name} (${email})`);
    
    const supabase = getSupabaseClient();
    
    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .or(`name.eq.${name},email.eq.${email}`)
      .single();

    if (existingUser) {
      console.log('❌ User already exists');
      res.status(409).json({ error: 'User with this name or email already exists' }); return;
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create new user
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({
        name,
        email,
        password_hash: passwordHash,
        total_xp: 0,
        current_level: 1,
        total_runs: 0,
        current_streak: 0,
        longest_streak: 0,
        total_km: 0.0
      })
      .select('id, name, email, total_xp, current_level, total_runs, current_streak, created_at')
      .single();

    if (error) {
      console.log('❌ Error creating user:', error.message);
      res.status(500).json({ error: 'Failed to create user' }); return;
    }

    console.log(`🎉 Successfully created user: ${newUser.name}`);

    res.json({
      success: true,
      data: newUser
    });

  } catch (error) {
    console.error('❌ Error creating user:', error);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
});

// PUT /api/auth/users/:id/password - Admin only: Reset user password
router.put('/users/:id/password', authenticateJWT, requireAdmin, async (req, res): Promise<void> => {
  try {
    console.log('🔐 Admin request to reset user password');
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword) {
      console.log('❌ Missing new password');
      res.status(400).json({ error: 'New password is required' }); return;
    }

    if (newPassword.length < 6) {
      console.log('❌ New password too short');
      res.status(400).json({ error: 'New password must be at least 6 characters long' }); return;
    }

    console.log(`🔍 Resetting password for user ID: ${id}`);
    
    const supabase = getSupabaseClient();
    
    // Verify user exists
    const { data: user, error: findError } = await supabase
      .from('users')
      .select('id, name')
      .eq('id', id)
      .single();

    if (findError || !user) {
      console.log('❌ User not found:', findError?.message);
      res.status(404).json({ error: 'User not found' }); return;
    }

    console.log(`✅ User found: ${user.name}, hashing new password`);

    // Hash new password
    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password in database
    const { error: updateError } = await supabase
      .from('users')
      .update({ password_hash: newPasswordHash })
      .eq('id', id);

    if (updateError) {
      console.log('❌ Error updating password:', updateError.message);
      res.status(500).json({ error: 'Failed to update password' }); return;
    }

    console.log(`🎉 Password successfully reset for user: ${user.name}`);

    res.json({
      success: true,
      message: 'Password reset successfully'
    });

  } catch (error) {
    console.error('❌ Password reset error:', error);
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
    console.log(`🔄 Recalculating totals for user ${userId}...`);
    
    const { calculateUserTotals } = await import('../utils/calculateUserTotals.js');
    await calculateUserTotals(userId);
    
    res.json({
      success: true,
      message: 'User totals recalculated successfully',
      userId: userId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error recalculating user totals:', error);
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
    console.log('🔍 Admin: Fetching admin settings...');
    
    const supabase = getSupabaseClient();
    const { data: settings, error } = await supabase
      .from('admin_settings')
      .select('*')
      .single();
    
    if (error) {
      console.error('❌ Failed to fetch admin settings:', error);
      res.status(500).json({ error: 'Failed to fetch admin settings' }); return;
    }
    
    console.log('✅ Admin settings fetched successfully');
    res.json({ success: true, data: settings });
    
  } catch (error) {
    console.error('❌ Error fetching admin settings:', error);
    res.status(500).json({ error: 'Failed to fetch admin settings' }); return;
  }
});

// PUT /api/auth/admin-settings - Update admin settings
router.put('/admin-settings', authenticateJWT, requireAdmin, async (req, res): Promise<void> => {
  try {
    console.log('💾 Admin: Updating admin settings...');
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
      .select()
      .single();
    
    if (error) {
      console.error('❌ Failed to update admin settings:', error);
      res.status(500).json({ error: 'Failed to update admin settings' }); return;
    }
    
    console.log('✅ Admin settings updated successfully');
    res.json({ 
      success: true, 
      data: updatedSettings,
      message: 'Admin settings updated successfully' 
    });
    
  } catch (error) {
    console.error('❌ Error updating admin settings:', error);
    res.status(500).json({ error: 'Failed to update admin settings' }); return;
  }
});

// GET /api/auth/streak-multipliers - Get streak multipliers
router.get('/streak-multipliers', authenticateJWT, requireAdmin, async (_req, res): Promise<void> => {
  try {
    console.log('🔍 Admin: Fetching streak multipliers...');
    
    const supabase = getSupabaseClient();
    const { data: multipliers, error } = await supabase
      .from('streak_multipliers')
      .select('*')
      .order('days');
    
    if (error) {
      console.error('❌ Failed to fetch streak multipliers:', error);
      res.status(500).json({ error: 'Failed to fetch streak multipliers' }); return;
    }
    
    console.log('✅ Streak multipliers fetched successfully');
    res.json({ success: true, data: multipliers });
    
  } catch (error) {
    console.error('❌ Error fetching streak multipliers:', error);
    res.status(500).json({ error: 'Failed to fetch streak multipliers' }); return;
  }
});

// PUT /api/auth/streak-multipliers - Update streak multipliers
router.put('/streak-multipliers', authenticateJWT, requireAdmin, async (req, res): Promise<void> => {
  try {
    console.log('💾 Admin: Updating streak multipliers...');
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
      .select();
    
    if (error) {
      console.error('❌ Failed to update streak multipliers:', error);
      res.status(500).json({ error: 'Failed to update streak multipliers' }); return;
    }
    
    console.log('✅ Streak multipliers updated successfully');
    res.json({ 
      success: true, 
      data: insertedMultipliers,
      message: 'Streak multipliers updated successfully' 
    });
    
  } catch (error) {
    console.error('❌ Error updating streak multipliers:', error);
    res.status(500).json({ error: 'Failed to update streak multipliers' }); return;
  }
});

// GET /api/auth/users-with-runs - Get all users with their runs (authenticated users)
router.get('/users-with-runs', authenticateJWT, async (_req, res): Promise<void> => {
  try {
    console.log('👥 Fetching all users with runs');
    
    const supabase = getSupabaseClient();
    
    // Fetch all users
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('*')
      .order('total_xp', { ascending: false });

    if (usersError) {
      console.error('❌ Error fetching users:', usersError.message);
      res.status(500).json({ error: 'Failed to fetch users' }); return;
    }

    // Fetch all runs
    const { data: runs, error: runsError } = await supabase
      .from('runs')
      .select('*')
      .order('date', { ascending: false });

    if (runsError) {
      console.error('❌ Error fetching runs:', runsError.message);
      res.status(500).json({ error: 'Failed to fetch runs' }); return;
    }

    // Combine users with their runs
    const usersWithRuns = users?.map(user => ({
      ...user,
      runs: runs?.filter(run => run.user_id === user.id) || []
    })) || [];

    console.log(`✅ Successfully fetched ${usersWithRuns.length} users with runs`);

    res.json({
      success: true,
      data: usersWithRuns
    });

  } catch (error) {
    console.error('❌ Error fetching users with runs:', error);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
});

export default router;
