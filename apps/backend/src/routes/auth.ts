// 🔐 Authentication Routes
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getSupabaseClient } from '../config/database.js';

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

export default router;