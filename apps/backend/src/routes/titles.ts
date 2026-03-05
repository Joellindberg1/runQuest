import express from 'express';
import { logger } from '../utils/logger.js';
import { titleLeaderboardService } from '../services/titleLeaderboardService';
import { enhancedTitleService } from '../services/enhancedTitleService';
import { supabase } from '../config/database';
import { authenticateJWT } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

const router = express.Router();

/**
 * GET /api/titles
 * Returns all titles
 */
router.get('/', authenticateJWT, async (_req, res) => {
  try {
    logger.info('🏆 API: Fetching all titles...');
    
    const titles = await titleLeaderboardService.getAllTitles();
    
    res.json({
      success: true,
      data: titles,
      meta: {
        total_titles: titles.length,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('❌ API Error in /titles:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch titles',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/titles/leaderboard
 * Returns optimized title leaderboard with holders and runners-up
 */
router.get('/leaderboard', authenticateJWT, async (_req, res) => {
  try {
    logger.info('📊 API: Fetching title leaderboard...');
    
    const leaderboard = await titleLeaderboardService.getTitleLeaderboard();
    
    res.json({
      success: true,
      data: leaderboard,
      meta: {
        total_titles: leaderboard.length,
        timestamp: new Date().toISOString(),
        cache_optimized: true
      }
    });
    
  } catch (error) {
    logger.error('❌ API Error in /titles/leaderboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch title leaderboard',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/titles/user/:userId
 * Returns titles for a specific user with their rankings
 */
router.get('/user/:userId', authenticateJWT, async (req, res) => {
  try {
    const { userId } = req.params;
    logger.info(`📊 API: Fetching titles for user ${userId}...`);
    
    const userTitles = await titleLeaderboardService.getUserTitles(userId);
    
    res.json({
      success: true,
      data: userTitles,
      meta: {
        user_id: userId,
        total_titles: userTitles.length,
        current_holder_count: userTitles.filter(t => t.is_current_holder).length,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error(`❌ API Error in /titles/user/${req.params.userId}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user titles',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/titles/refresh/:titleId
 * Refresh leaderboard for a specific title
 */
router.post('/refresh/:titleId', authenticateJWT, async (req, res) => {
  try {
    const { titleId } = req.params;
    logger.info(`🔄 API: Refreshing leaderboard for title ${titleId}...`);
    
    await titleLeaderboardService.refreshTitleLeaderboard(titleId);
    
    res.json({
      success: true,
      message: `Title leaderboard refreshed for ${titleId}`,
      title_id: titleId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error(`❌ API Error in /titles/refresh/${req.params.titleId}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh title leaderboard',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/titles/populate
 * Manually populate title leaderboards from user data (admin only)
 */
router.post('/populate', authenticateJWT, requireAdmin, async (_req, res) => {
  try {
    logger.info('🔄 API: Manual title leaderboard population requested...');
    
    await titleLeaderboardService.populateTitleLeaderboard();
    
    res.status(200).json({
      success: true,
      message: 'Title leaderboards populated successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('❌ API Error in /titles/populate:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to populate title leaderboards',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/titles/refresh
 * Refresh title leaderboards - can be called automatically when data changes
 */
router.post('/refresh', authenticateJWT, requireAdmin, async (_req, res) => {
  try {
    logger.info('🔄 API: Title leaderboard refresh requested...');
    
    await titleLeaderboardService.populateTitleLeaderboard();
    
    res.status(200).json({
      success: true,
      message: 'Title leaderboards refreshed successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('❌ API Error in /titles/refresh:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh title leaderboards',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/titles/group-eligibility
 * Returns server-calculated title achievement values for all users in the caller's group.
 * Single source of truth — frontend should display these values, not recalculate locally.
 */
router.get('/group-eligibility', authenticateJWT, async (req: any, res) => {
  try {
    const callerId: string = req.user.userId;

    // Get caller's group_id
    const { data: caller, error: callerError } = await supabase.client
      .from('users')
      .select('group_id')
      .eq('id', callerId)
      .single();

    if (callerError || !caller?.group_id) {
      res.status(400).json({ success: false, error: 'No group found for user' });
      return;
    }

    // Get all non-admin users in the group
    const { data: users, error: usersError } = await supabase.client
      .from('users')
      .select('id, name, total_km, longest_streak')
      .eq('group_id', caller.group_id)
      .neq('name', 'Admin');

    if (usersError || !users) {
      res.status(500).json({ success: false, error: 'Failed to fetch group users' });
      return;
    }

    // For each user, fetch runs and calculate values
    const eligibilityResults = await Promise.all(
      users.map(async (user: any) => {
        const { data: runs } = await supabase.client
          .from('runs')
          .select('date, distance')
          .eq('user_id', user.id)
          .order('date', { ascending: true });

        const runsWithAlias = (runs ?? []).map((r: any) => ({ ...r, distance_km: r.distance }));
        const values = enhancedTitleService.calculateUserValues(
          runsWithAlias,
          user.total_km || 0,
          user.longest_streak || 0
        );

        return {
          userId: user.id,
          name: user.name,
          longestRun: values.longestRun,
          weekendAvg: values.weekendAvg,
          longestStreak: values.longestStreak,
          totalKm: values.totalKm,
        };
      })
    );

    res.json({ success: true, data: eligibilityResults });
  } catch (error) {
    logger.error('❌ API Error in /titles/group-eligibility:', error);
    res.status(500).json({ success: false, error: 'Failed to calculate group eligibility' });
  }
});

export default router;