// ⚙️ Config Routes (ADR 007 B4)
import express from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import { getXpConfig } from '../services/xpConfig.js';
import { levelService } from '../services/levelService.js';
import { logger } from '../utils/logger.js';
import type { ApiError, XpConfigApiResponse, LevelsApiResponse } from '@runquest/shared';
import { errorCode } from '../utils/errorCode.js';

const router = express.Router();

// GET /api/config/xp — effektiva XP-värden för alla inloggade (Playbook, Estimated XP).
// Konfigen är global; ingen gruppavgränsning. Hemligheter (admin_password_hash) når aldrig hit —
// xpConfig selectar en explicit kolumnlista.
router.get('/xp', authenticateJWT, async (_req, res): Promise<void> => {
  try {
    const { settings, streak_multipliers, meta } = await getXpConfig();
    const body: XpConfigApiResponse = { success: true, data: { settings, streak_multipliers }, meta };
    res.json(body);
  } catch (error) {
    logger.error(`❌ Error fetching XP config (${errorCode(error)})`);
    res.status(500).json({ error: 'Failed to fetch XP config' } satisfies ApiError);
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
    const body: LevelsApiResponse = { success: true, data };
    res.json(body);
  } catch (error) {
    logger.error(`❌ Error fetching level requirements (${errorCode(error)})`);
    res.status(500).json({ error: 'Failed to fetch level requirements' } satisfies ApiError);
  }
});

export default router;
