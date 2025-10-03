import express from 'express';
import { titleLeaderboardService } from '../services/titleLeaderboardService';
import { authenticateJWT } from '../middleware/auth';

const router = express.Router();

/**
 * GET /api/titles/leaderboard
 * Returns optimized title leaderboard with holders and runners-up
 */
router.get('/leaderboard', authenticateJWT, async (req, res) => {
  try {
    console.log('📊 API: Fetching title leaderboard...');
    
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
    console.error('❌ API Error in /titles/leaderboard:', error);
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
    console.log(`📊 API: Fetching titles for user ${userId}...`);
    
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
    console.error(`❌ API Error in /titles/user/${req.params.userId}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user titles',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/titles/refresh
 * Manually refresh all title leaderboards (admin only)
 */
router.post('/refresh', authenticateJWT, async (req, res) => {
  try {
    console.log('🔄 API: Manual title leaderboard refresh requested...');
    
    await titleLeaderboardService.refreshAllTitleLeaderboards();
    
    res.json({
      success: true,
      message: 'All title leaderboards refreshed successfully',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ API Error in /titles/refresh:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh title leaderboards',
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
    console.log(`🔄 API: Refreshing leaderboard for title ${titleId}...`);
    
    await titleLeaderboardService.refreshTitleLeaderboard(titleId);
    
    res.json({
      success: true,
      message: `Title leaderboard refreshed for ${titleId}`,
      title_id: titleId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error(`❌ API Error in /titles/refresh/${req.params.titleId}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh title leaderboard',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;