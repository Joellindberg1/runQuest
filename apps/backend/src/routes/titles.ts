import express from 'express';
import { logger } from '../utils/logger.js';
import { titleLeaderboardService } from '../services/titleLeaderboardService';
import { enhancedTitleService } from '../services/enhancedTitleService';
import { getGroupEligibility } from '../services/groupEligibility';
import { authenticateJWT } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { errorCode } from '../utils/errorCode.js';
import { groupIdOrRespondEmpty, groupIdOrRespondForbidden } from '../utils/groupScope.js';
import type {
  GroupEligibilityResponse, TitleCatalogResponse, TitleLeaderboardResponse, TitlesPopulateResponse, TitlesRefreshResponse, TitlesReprocessDoneResponse,
  TitlesReprocessFailedResponse, UserTitlesResponse,
} from '@runquest/shared';
import { fail, failWithLegacy, ok, okWithLegacy } from '../utils/respond.js';

const router = express.Router();

/**
 * GET /api/titles
 * Returns all titles
 */
router.get('/', authenticateJWT, async (_req, res) => {
  try {
    logger.info('🏆 API: Fetching all titles...');
    
    const titles = await titleLeaderboardService.getAllTitles();
    
    ok<TitleCatalogResponse>(res, titles, {
      total_titles: titles.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error(`❌ API Error in /titles (${errorCode(error)})`);
    fail(res, 500, 'Failed to fetch titles');
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

    ok<TitleLeaderboardResponse>(res, leaderboard, {
      total_titles: leaderboard.length,
      timestamp: new Date().toISOString(),
      cache_optimized: true
    });
    
  } catch (error) {
    logger.error(`❌ API Error in /titles/leaderboard (${errorCode(error)})`);
    fail(res, 500, 'Failed to fetch title leaderboard');
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
      fail(res, 404, 'User not found');
      return;
    }

    ok<UserTitlesResponse>(res, userTitles, {
      user_id: userId,
      total_titles: userTitles.length,
      current_holder_count: userTitles.filter(t => t.is_current_holder).length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error(`❌ API Error in /titles/user/:userId (${errorCode(error)})`);
    fail(res, 500, 'Failed to fetch user titles');
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
    
    const timestamp = new Date().toISOString();
    okWithLegacy<TitlesPopulateResponse>(res, { timestamp }, { message: 'Title leaderboards populated successfully', timestamp });
  } catch (error) {
    logger.error(`❌ API Error in /titles/populate (${errorCode(error)})`);
    fail(res, 500, 'Failed to populate title leaderboards');
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
    
    const timestamp = new Date().toISOString();
    okWithLegacy<TitlesRefreshResponse>(res, { timestamp }, { message: 'Title leaderboards refreshed successfully', timestamp });
  } catch (error) {
    logger.error(`❌ API Error in /titles/refresh (${errorCode(error)})`);
    fail(res, 500, 'Failed to refresh title leaderboards');
  }
});

/**
 * POST /api/titles/reprocess-all
 * Recalculates user_titles for all users from scratch using current algorithm, then refreshes leaderboard.
 *
 * Ärligt svar (RUN-158): räknarna total, processed och failed i `data` (och, under dubbelsvarsfönstret, på toppnivå bredvid `message`). Ett fel hos en användare
 * stoppar inte körningen (RUN-157), så statusen speglar utfallet: 200 när alla lyckades, 207 `partial_failure` när bara några misslyckades
 * (success:false — en del av arbetet är gjort och en del inte, ADR 007 Addendum 2026-10-20 punkt 4), 500 när ingen lyckades.
 */
router.post('/reprocess-all', authenticateJWT, requireAdmin, async (_req, res) => {
  try {
    logger.info('🔄 API: Full title reprocess requested...');
    // Admin-underhåll ska inte spamma Pack News (ADR 008 beslut 6).
    const { total, processed, failed } = await enhancedTitleService.processAllGroupsTitles({ emitNews: false });
    const counts = { total, processed, failed };

    if (failed === 0) {
      okWithLegacy<TitlesReprocessDoneResponse>(res, counts, { message: 'All user titles reprocessed and leaderboards refreshed', ...counts });
      return;
    }

    logger.warn(`⚠️ Title reprocess finished with failures: ${failed} of ${total} users failed`);
    if (processed === 0) {
      const message = `All ${total} users failed`;
      const allFailed = { message, ...counts } satisfies Omit<TitlesReprocessFailedResponse, 'success' | 'error' | 'code' | 'data'>;
      failWithLegacy(res, 500, message, 'internal_error', counts, allFailed);
      return;
    }
    const message = `${failed} of ${total} users failed; the rest were recalculated`;
    const partial = { message, ...counts } satisfies Omit<TitlesReprocessFailedResponse, 'success' | 'error' | 'code' | 'data'>;
    failWithLegacy(res, 207, message, 'partial_failure', counts, partial);
  } catch (error) {
    logger.error(`❌ API Error in /titles/reprocess-all (${errorCode(error)})`);
    fail(res, 500, 'Failed to reprocess titles');
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

    ok<GroupEligibilityResponse>(res, await getGroupEligibility(groupId));
  } catch (error) {
    logger.error(`❌ API Error in /titles/group-eligibility (${errorCode(error)})`);
    fail(res, 500, 'Failed to calculate group eligibility');
  }
});

export default router;