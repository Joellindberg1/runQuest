const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testLogin() {
    try {
        console.log('🔍 Testing login for Joel...');
        
        // First, let's see Joel's user data
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('email', 'joellindberg1@live.se')
            .single();
            
        if (userError) {
            console.error('❌ Error getting user:', userError);
            return;
        }
        
        console.log('👤 User data:', {
            id: user.id,
            name: user.name,
            email: user.email,
            is_admin: user.is_admin,
            hasPassword: !!user.password_hash
        });
        
        // Test password comparison
        const isValidPassword = await bcrypt.compare('123599', user.password_hash);
        console.log('🔒 Password valid:', isValidPassword);
        
        if (isValidPassword) {
            // Create token like the server does
            const token = jwt.sign(
                { 
                    user_id: user.id,
                    email: user.email,
                    is_admin: user.is_admin 
                },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );
            
            console.log('🎫 Generated token:', token.substring(0, 50) + '...');
            
            // Try to fetch users using our token
            console.log('🔍 Testing admin access...');
            
            const response = await fetch('http://localhost:3000/api/auth/users', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const users = await response.json();
                console.log('✅ Admin access successful! Users:', users.length);
            } else {
                const error = await response.text();
                console.error('❌ Admin access failed:', response.status, error);
            }
        }
        
    } catch (error) {
        console.error('❌ Script error:', error);
    }
}

testLogin();