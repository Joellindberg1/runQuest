// ⚙️ Config Routes (ADR 007 B4)
import express from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import { getXpConfig } from '../services/xpConfig.js';
import { levelService } from '../services/levelService.js';
import { logger } from '../utils/logger.js';
import type { XpConfigApiResponse, LevelsApiResponse } from '@runquest/shared';
import { fail, ok } from '../utils/respond.js';
import { errorCode } from '../utils/errorCode.js';

const router = express.Router();

// GET /api/config/xp — effektiva XP-värden för alla inloggade (Playbook, Estimated XP).
// Konfigen är global; ingen gruppavgränsning. Hemligheter (admin_password_hash) når aldrig hit —
// xpConfig selectar en explicit kolumnlista.
router.get('/xp', authenticateJWT, async (_req, res): Promise<void> => {
  try {
    const { settings, streak_multipliers, meta } = await getXpConfig();
    ok<XpConfigApiResponse>(res, { settings, streak_multipliers }, meta);
  } catch (error) {
    logger.error(`❌ Error fetching XP config (${errorCode(error)})`);
    fail(res, 500, 'Failed to fetch XP config');
  }
});

// GET /api/config/levels — nivåtabellen (level_requirements) för alla inloggade (RUN-110, ADR 004).
// Global tabell; ingen gruppavgränsning. levelService äger läsning + cache + fallback.
router.get('/levels', authenticateJWT, async (_req, res): Promise<void> => {
  try {
    const rows = await levelService.getAllLevelRequirements();
    const data = rows
      .map(({ level, xp_required }) => ({ level, xp_required }))
      .sort((a, b) => a.level - b.level);
    ok<LevelsApiResponse>(res, data);
  } catch (error) {
    logger.error(`❌ Error fetching level requirements (${errorCode(error)})`);
    fail(res, 500, 'Failed to fetch level requirements');
  }
});

export default router;
