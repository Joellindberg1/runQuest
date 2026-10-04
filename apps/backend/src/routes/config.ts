// ⚙️ Config Routes (ADR 007 B4)
import express from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import { getXpConfig } from '../services/xpConfig.js';
import { logger } from '../utils/logger.js';
import type { XpConfigApiResponse } from '@runquest/shared';

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
    logger.error('❌ Error fetching XP config:', error);
    res.status(500).json({ error: 'Failed to fetch XP config' });
  }
});

export default router;
