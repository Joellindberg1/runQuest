// 🎓 Onboarding Routes
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import type { OnboardingMarkSeenRequest, OnboardingMarkSeenResponse, OnboardingStatusResponse } from '@runquest/shared';
import { fail, okWithLegacy } from '../utils/respond.js';

const router = express.Router();

// ─── GET /api/onboarding/status ───────────────────────────────────────────────
// Returns all slugs the authenticated user has already seen.

router.get('/status', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('user_seen_items')
      .select('item_slug')
      .eq('user_id', req.user!.user_id);

    if (error) throw error;

    const seen = (data ?? []).map((r: { item_slug: string }) => r.item_slug);
    okWithLegacy<OnboardingStatusResponse>(res, { seen }, { seen });
  } catch (e) {
    fail(res, 500, 'Failed to fetch onboarding status');
  }
});

// ─── POST /api/onboarding/mark-seen ───────────────────────────────────────────
// Marks a slug as seen. Idempotent — safe to call multiple times.

router.post('/mark-seen', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const { slug }: Partial<OnboardingMarkSeenRequest> = req.body;

    if (!slug || typeof slug !== 'string') {
      fail(res, 400, 'slug is required and must be a string');
      return;
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('user_seen_items')
      .upsert(
        { user_id: req.user!.user_id, item_slug: slug },
        { onConflict: 'user_id,item_slug' }
      );

    if (error) throw error;

    okWithLegacy<OnboardingMarkSeenResponse>(res, null, { ok: true });
  } catch (e) {
    fail(res, 500, 'Failed to mark item as seen');
  }
});

export default router;
