import express from 'express';
import { logger } from '../utils/logger.js';
import { titleLeaderboardService } from '../services/titleLeaderboardService';
import { enhancedTitleService } from '../services/enhancedTitleService';
import { getGroupEligibility } from '../services/groupEligibility';
import { authenticateJWT } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { errorCode } from '../utils/errorCode.js';
import { groupIdOrRespondEmpty, groupIdOrRespondForbidden } from '../utils/groupScope.js';
import type { GroupEligibilityResponse, TitleLeaderboardResponse, UserTitlesResponse } from '@runquest/shared';

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
    logger.error(`❌ API Error in /titles (${errorCode(error)})`);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch titles'
    });
  }
});

/**
 * GET /api/titles/leaderboard
 * Returns the title catalog with the caller's group as holders and runners-up (ADR 012 beslut 5.1).
 * A caller without a group gets an empty list (ADR 007 A6, fail-closed).
 */
router.get('/leaderboard', authenticateJWT, async (req, res) => {
  try {
    const emptyBody: TitleLeaderboardResponse = {
      success: true,
      data: [],
      meta: { total_titles: 0, timestamp: new Date().toISOString(), cache_optimized: true },
    };
    const groupId = groupIdOrRespondEmpty(req, res, emptyBody);
    if (!groupId) return;

    logger.info('📊 API: Fetching title leaderboard...');

    const leaderboard = await titleLeaderboardService.getTitleLeaderboard(groupId);

    const body: TitleLeaderboardResponse = {
      success: true,
      data: leaderboard,
      meta: {
        total_titles: leaderboard.length,
        timestamp: new Date().toISOString(),
        cache_optimized: true
      }
    };
    res.json(body);
    
  } catch (error) {
    logger.error(`❌ API Error in /titles/leaderboard (${errorCode(error)})`);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch title leaderboard'
    });
  }
});

/**
 * GET /api/titles/user/:userId
 * Returns titles for a user in the caller's group with their rankings in the group (ADR 012 beslut 5.2).
 * 404 for a user outside the caller's group, with the same answer as for a user that does not exist, so the answer never reveals
 * who exists in another group. A caller without a group gets an empty list (ADR 007 A6, fail-closed).
 */
router.get('/user/:userId', authenticateJWT, async (req, res) => {
  try {
    const { userId } = req.params;
    const emptyBody: UserTitlesResponse = {
      success: true,
      data: [],
      meta: { user_id: userId, total_titles: 0, current_holder_count: 0, timestamp: new Date().toISOString() },
    };
    const groupId = groupIdOrRespondEmpty(req, res, emptyBody);
    if (!groupId) return;

    logger.info(`📊 API: Fetching titles for user ${userId}...`);

    const userTitles = await titleLeaderboardService.getUserTitles(groupId, userId);
    if (!userTitles) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const body: UserTitlesResponse = {
      success: true,
      data: userTitles,
      meta: {
        user_id: userId,
        total_titles: userTitles.length,
        current_holder_count: userTitles.filter(t => t.is_current_holder).length,
        timestamp: new Date().toISOString()
      }
    };
    res.json(body);
    
  } catch (error) {
    logger.error(`❌ API Error in /titles/user/:userId (${errorCode(error)})`);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user titles'
    });
  }
});

/**
 * POST /api/titles/populate
 * Manually populate the title leaderboards of the admin's own group from user data (admin only; never other groups, ADR 012 beslut 4.3)
 */
router.post('/populate', authenticateJWT, requireAdmin, async (req, res) => {
  try {
    const groupId = groupIdOrRespondForbidden(req, res);
    if (!groupId) return;

    logger.info('🔄 API: Manual title leaderboard population requested...');

    await titleLeaderboardService.populateTitleLeaderboard(groupId);
    
    res.status(200).json({
      success: true,
      message: 'Title leaderboards populated successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`❌ API Error in /titles/populate (${errorCode(error)})`);
    res.status(500).json({
      success: false,
      error: 'Failed to populate title leaderboards'
    });
  }
});

/**
 * POST /api/titles/refresh
 * Refresh the title leaderboards of the admin's own group (admin only; never other groups, ADR 012 beslut 4.3)
 */
router.post('/refresh', authenticateJWT, requireAdmin, async (req, res) => {
  try {
    const groupId = groupIdOrRespondForbidden(req, res);
    if (!groupId) return;

    logger.info('🔄 API: Title leaderboard refresh requested...');

    await titleLeaderboardService.populateTitleLeaderboard(groupId);
    
    res.status(200).json({
      success: true,
      message: 'Title leaderboards refreshed successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`❌ API Error in /titles/refresh (${errorCode(error)})`);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh title leaderboards'
    });
  }
});

/**
 * POST /api/titles/reprocess-all
 * Recalculates user_titles for all users from scratch using current algorithm, then refreshes leaderboard.
 *
 * Ärligt svar (RUN-158): {success, message, total, processed, failed}. Ett fel hos en användare stoppar inte
 * körningen (RUN-157), så statusen speglar utfallet: 200 när alla lyckades, 207 när bara några misslyckades
 * (success:false — en del av arbetet är gjort och en del inte), 500 när ingen lyckades.
 */
router.post('/reprocess-all', authenticateJWT, requireAdmin, async (_req, res) => {
  try {
    logger.info('🔄 API: Full title reprocess requested...');
    // Admin-underhåll ska inte spamma Pack News (ADR 008 beslut 6).
    const { total, processed, failed } = await enhancedTitleService.processAllGroupsTitles({ emitNews: false });
    const counts = { total, processed, failed };

    if (failed === 0) {
      res.status(200).json({ success: true, message: 'All user titles reprocessed and leaderboards refreshed', ...counts });
      return;
    }

    logger.warn(`⚠️ Title reprocess finished with failures: ${failed} of ${total} users failed`);
    if (processed === 0) {
      const message = `All ${total} users failed`;
      // ADR 007 A1: 5xx-svar bär error bredvid message (additivt).
      res.status(500).json({ success: false, error: message, message, ...counts });
      return;
    }
    res.status(207).json({ success: false, message: `${failed} of ${total} users failed; the rest were recalculated`, ...counts });
  } catch (error) {
    logger.error(`❌ API Error in /titles/reprocess-all (${errorCode(error)})`);
    res.status(500).json({ success: false, error: 'Failed to reprocess titles' });
  }
});

/**
 * GET /api/titles/group-eligibility
 * Returns server-calculated title achievement values for the active members of the caller's group, counted on each membership's
 * window (ADR 012 beslut 5.7) with the group's own recalculation clock (beslut 5.6).
 * Single source of truth — frontend should display these values, not recalculate locally.
 * A caller without a group gets an empty list (ADR 007 A6, fail-closed).
 */
router.get('/group-eligibility', authenticateJWT, async (req, res) => {
  try {
    const groupId = groupIdOrRespondEmpty(req, res);
    if (!groupId) return;

    const body: GroupEligibilityResponse = { success: true, data: await getGroupEligibility(groupId) };
    res.json(body);
  } catch (error) {
    logger.error(`❌ API Error in /titles/group-eligibility (${errorCode(error)})`);
    res.status(500).json({ success: false, error: 'Failed to calculate group eligibility' });
  }
});

export default router;