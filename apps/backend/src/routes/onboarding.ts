// 🎓 Onboarding Routes
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';

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

    res.json({ seen: (data ?? []).map((r: { item_slug: string }) => r.item_slug) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch onboarding status' });
  }
});

// ─── POST /api/onboarding/mark-seen ───────────────────────────────────────────
// Marks a slug as seen. Idempotent — safe to call multiple times.

router.post('/mark-seen', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const { slug } = req.body;

    if (!slug || typeof slug !== 'string') {
      res.status(400).json({ error: 'slug is required and must be a string' });
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

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to mark item as seen' });
  }
});

export default router;
