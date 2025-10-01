// 🔐 Authentication Routes
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    console.log('🔐 Login attempt received');
    const { name, email, password } = req.body;
    const nameOrEmail = name || email;

    if (!nameOrEmail || !password) {
      console.log('❌ Missing name/email or password');
      return res.status(400).json({ error: 'Name/email and password required' });
    }

    console.log(`🔍 Looking up user: ${nameOrEmail}`);
    
    // Get Supabase client and query users table
    const supabase = getSupabaseClient();
    
    // Try to find user by email first, then by name
    let { data: user, error } = await supabase
      .from('users')
      .select('id, name, email, password_hash')
      .eq('email', nameOrEmail)
      .single();
    
    // If not found by email, try by name
    if (error || !user) {
      const { data: userByName, error: errorByName } = await supabase
        .from('users')
        .select('id, name, email, password_hash')
        .eq('name', nameOrEmail)
        .single();
      
      user = userByName;
      error = errorByName;
    }

    if (error || !user) {
      console.log('❌ User not found or database error:', error?.message);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log(`🔑 User found, verifying password for: ${user.name}`);

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      console.log('❌ Password mismatch');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log('✅ Password verified, creating JWT token');

    // Create JWT token
    const token = jwt.sign(
      {
        user_id: user.id,
        name: user.name,
        email: user.email
      },
      process.env.JWT_SECRET as string,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    console.log(`🎉 Login successful for user: ${user.name}`);

    // Return token and user info
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/refresh (placeholder for now)
router.post('/refresh', async (req, res) => {
  console.log('🔄 Token refresh requested (not implemented yet)');
  res.json({ message: 'Token refresh - to be implemented' });
});

// POST /api/auth/change-password
router.post('/change-password', authenticateJWT, async (req, res) => {
  try {
    console.log('🔐 Password change attempt received');
    const { currentPassword, newPassword } = req.body;
    const userId = (req as any).user.user_id;

    if (!currentPassword || !newPassword) {
      console.log('❌ Missing current or new password');
      return res.status(400).json({ error: 'Current password and new password required' });
    }

    if (newPassword.length < 6) {
      console.log('❌ New password too short');
      return res.status(400).json({ error: 'New password must be at least 6 characters long' });
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
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`🔑 User found, verifying current password for: ${user.name}`);

    // Verify current password
    const passwordMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!passwordMatch) {
      console.log('❌ Current password is incorrect');
      return res.status(401).json({ error: 'Current password is incorrect' });
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
      return res.status(500).json({ error: 'Failed to update password' });
    }

    console.log(`🎉 Password successfully changed for user: ${user.name}`);

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('❌ Password change error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/users - Admin only: Get all users
router.get('/users', authenticateJWT, async (req, res) => {
  try {
    console.log('👥 Admin request to fetch all users');
    
    const supabase = getSupabaseClient();
    
    const { data: users, error } = await supabase
      .from('users')
      .select('id, name, email, total_xp, current_level, total_runs, current_streak, created_at')
      .order('created_at', { ascending: true });

    if (error) {
      console.log('❌ Error fetching users:', error.message);
      return res.status(500).json({ error: 'Failed to fetch users' });
    }

    console.log(`✅ Successfully fetched ${users?.length || 0} users`);

    res.json({
      success: true,
      data: users
    });

  } catch (error) {
    console.error('❌ Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/users - Admin only: Create new user
router.post('/users', authenticateJWT, async (req, res) => {
  try {
    console.log('👤 Admin request to create new user');
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      console.log('❌ Missing required fields');
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    if (password.length < 6) {
      console.log('❌ Password too short');
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    console.log(`🔍 Creating user: ${name} (${email})`);
    
    const supabase = getSupabaseClient();
    
    // Check if user already exists
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id')
      .or(`name.eq.${name},email.eq.${email}`)
      .single();

    if (existingUser) {
      console.log('❌ User already exists');
      return res.status(409).json({ error: 'User with this name or email already exists' });
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
      return res.status(500).json({ error: 'Failed to create user' });
    }

    console.log(`🎉 Successfully created user: ${newUser.name}`);

    res.json({
      success: true,
      data: newUser
    });

  } catch (error) {
    console.error('❌ Error creating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/auth/users/:id/password - Admin only: Reset user password
router.put('/users/:id/password', authenticateJWT, async (req, res) => {
  try {
    console.log('🔐 Admin request to reset user password');
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword) {
      console.log('❌ Missing new password');
      return res.status(400).json({ error: 'New password is required' });
    }

    if (newPassword.length < 6) {
      console.log('❌ New password too short');
      return res.status(400).json({ error: 'New password must be at least 6 characters long' });
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
      return res.status(404).json({ error: 'User not found' });
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
      return res.status(500).json({ error: 'Failed to update password' });
    }

    console.log(`🎉 Password successfully reset for user: ${user.name}`);

    res.json({
      success: true,
      message: 'Password reset successfully'
    });

  } catch (error) {
    console.error('❌ Password reset error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;