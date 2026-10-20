// Publik summering (ingen JWT): GET /api/public/stats → { success, data: { runners, challenges, km } }.
// Cachen i tjänsten skyddar databasen, därför ingen egen rate limit.
import express from 'express';
import { getPublicStats, PUBLIC_STATS_TTL_MS } from '../services/publicStats.js';
import { logger } from '../utils/logger.js';
import { errorCode } from '../utils/errorCode.js';
import type { ApiError, PublicStatsApiResponse } from '@runquest/shared';

const router = express.Router();

router.get('/stats', async (_req, res) => {
  try {
    const { runners, challenges, km } = await getPublicStats();
    res.set('Cache-Control', `public, max-age=${PUBLIC_STATS_TTL_MS / 1000}`);
    res.json({ success: true, data: { runners, challenges, km } } satisfies PublicStatsApiResponse);
  } catch (error) {
    logger.error(`❌ Error loading public stats (${errorCode(error)})`);
    res.status(500).json({ error: 'Failed to load stats' } satisfies ApiError);
  }
});

export default router;
