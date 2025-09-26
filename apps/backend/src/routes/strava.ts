// 🔗 Strava Integration Routes
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = express.Router();

// GET /api/strava/config - Get Strava client ID
router.get('/config', async (req, res) => {
  try {
    console.log('⚙️ Strava config requested');
    
    const clientId = process.env.STRAVA_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({ error: 'Strava client ID not configured' });
    }
    
    res.json({ client_id: clientId });
  } catch (error) {
    console.error('❌ Strava config error:', error);
    res.status(500).json({ error: 'Failed to get Strava config' });
  }
});

// GET /api/strava/status - Check user's Strava connection status  
router.get('/status', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user!.user_id;
    console.log('🔍 Checking Strava status for user:', req.user!.name);
    
    const supabase = getSupabaseClient();
    const { data: tokens, error } = await supabase
      .from('strava_tokens')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    if (error || !tokens) {
      console.log('❌ No Strava tokens found for user');
      return res.json({ connected: false, expired: false });
    }
    
    const now = Math.floor(Date.now() / 1000);
    const expired = tokens.expires_at ? tokens.expires_at < now : false;
    
    console.log('✅ Strava status:', { connected: true, expired, expires_at: tokens.expires_at });
    
    res.json({
      connected: true,
      expired,
      expires_at: tokens.expires_at
    });
    
  } catch (error) {
    console.error('❌ Strava status error:', error);
    res.status(500).json({ error: 'Failed to check Strava status' });
  }
});

// POST /api/strava/callback - Handle Strava OAuth callback
router.post('/callback', authenticateJWT, async (req, res) => {
  try {
    const { code } = req.body;
    const userId = req.user!.user_id;
    
    if (!code) {
      return res.status(400).json({ error: 'Authorization code required' });
    }
    
    console.log(`🔗 Processing Strava callback for user: ${req.user!.name}`);
    console.log(`🔑 Auth code: ${code.substring(0, 10)}...`);
    
    // Exchange code for access token
    const clientId = process.env.STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: 'Strava credentials not configured' });
    }
    
    const tokenResponse = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code'
      })
    });
    
    const tokenData = await tokenResponse.json();
    
    if (!tokenResponse.ok) {
      console.error('❌ Strava token exchange failed:', tokenData);
      return res.status(400).json({ error: 'Failed to exchange authorization code' });
    }
    
    console.log('✅ Strava tokens received:', {
      access_token: tokenData.access_token ? `${tokenData.access_token.substring(0, 10)}...` : 'missing',
      expires_at: tokenData.expires_at
    });
    
    // Save tokens to database
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('strava_tokens')
      .upsert({
        user_id: userId,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: tokenData.expires_at,
        connection_date: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) {
      console.error('❌ Failed to save Strava tokens:', error);
      return res.status(500).json({ error: 'Failed to save Strava connection' });
    }
    
    console.log('✅ Strava tokens saved successfully');
    
    res.json({
      success: true,
      message: 'Strava connected successfully',
      athlete: tokenData.athlete
    });
    
  } catch (error) {
    console.error('❌ Strava callback error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;