// Admin-endpoints under /api/admin (nya admin-vyer läggs här). ADR 007 A: { success, data } / { error }.
// Läsning sker via backend (service role); tabellerna har ingen anon-/authenticated-åtkomst.
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { logger } from '../utils/logger.js';
import type { AdminWaitlistApiResponse, AdminWaitlistEntry } from '@runquest/shared';

const router = express.Router();

// En väntelista på nivå 1 är liten; PostgREST kapar ändå vid 1000 rader, så gränsen sägs ut. `total` är det exakta antalet.
const WAITLIST_LIST_LIMIT = 1000;

// GET /api/admin/waitlist — nyast först (id som tie-breaker så att ordningen är stabil).
router.get('/waitlist', authenticateJWT, requireAdmin, async (_req, res): Promise<void> => {
  const { data, error, count } = await getSupabaseClient()
    .from('waitlist_signups')
    .select('id, email, created_at, source', { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(WAITLIST_LIST_LIMIT);

  if (error) {
    logger.error(`❌ Admin waitlist read failed (code ${error.code ?? 'unknown'})`);
    res.status(500).json({ error: 'Failed to load the waitlist' });
    return;
  }

  const entries = ((data ?? []) as AdminWaitlistEntry[]).map((row) => ({ id: row.id, email: row.email, created_at: row.created_at, source: row.source }));
  const response: AdminWaitlistApiResponse = { success: true, data: { entries, total: count ?? entries.length } };
  res.json(response);
});

export default router;
