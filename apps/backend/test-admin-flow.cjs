const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testAdminFlow() {
    try {
        console.log('🧪 Testing admin authentication flow...');
        
        // Step 1: Login to get token
        console.log('\n📝 Step 1: Login to get JWT token');
        const loginResponse = await fetch('http://localhost:3001/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'joellindberg1@live.se',
                password: '123599'
            })
        });
        
        if (!loginResponse.ok) {
            const error = await loginResponse.text();
            console.error('❌ Login failed:', error);
            return;
        }
        
        const loginData = await loginResponse.json();
        console.log('✅ Login successful');
        console.log('🎫 Token received:', loginData.token ? 'Yes' : 'No');
        
        // Step 2: Decode token to see what's inside
        console.log('\n🔍 Step 2: Decode JWT token');
        const decoded = jwt.decode(loginData.token);
        console.log('📊 Token payload:', decoded);
        
        // Step 3: Verify token manually
        console.log('\n🔐 Step 3: Verify JWT token');
        try {
            const verified = jwt.verify(loginData.token, process.env.JWT_SECRET);
            console.log('✅ Token verification successful');
            console.log('📊 Verified payload:', verified);
        } catch (verifyError) {
            console.error('❌ Token verification failed:', verifyError.message);
            return;
        }
        
        // Step 4: Check user directly in database
        console.log('\n🗄️  Step 4: Check user admin status in database');
        const { data: dbUser, error: dbError } = await supabase
            .from('users')
            .select('id, name, email, is_admin')
            .eq('id', decoded.user_id)
            .single();
            
        if (dbError) {
            console.error('❌ Database error:', dbError);
            return;
        }
        
        console.log('✅ Database user found:', dbUser);
        
        // Step 5: Test the users endpoint
        console.log('\n🌐 Step 5: Test admin users endpoint');
        const usersResponse = await fetch('http://localhost:3000/api/auth/users', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${loginData.token}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('📡 Response status:', usersResponse.status);
        
        if (usersResponse.ok) {
            const usersData = await usersResponse.json();
            console.log('✅ Users endpoint successful!');
            console.log('👥 Users count:', usersData.data?.length || 0);
        } else {
            const errorText = await usersResponse.text();
            console.error('❌ Users endpoint failed:', errorText);
            
            // Let's also check the response headers
            console.log('📋 Response headers:');
            for (const [key, value] of usersResponse.headers.entries()) {
                console.log(`  ${key}: ${value}`);
            }
        }
        
    } catch (error) {
        console.error('❌ Test script error:', error);
    }
}

testAdminFlow();