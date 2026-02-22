-- Database-driven Admin System Setup SQL
-- Run this in Supabase SQL Editor

-- 1. Add is_admin column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

-- 2. Set Joel Lindberg as admin
UPDATE users 
SET is_admin = TRUE 
WHERE name = 'Joel Lindberg';

-- 3. Verify admin users
SELECT id, name, email, is_admin 
FROM users 
WHERE is_admin = TRUE;

-- 4. Show all users with admin status
SELECT name, email, is_admin 
FROM users 
ORDER BY is_admin DESC, name ASC;