/**
 * RUN-119, flöde 9 (rök): logga en runda → calculateUserTotals → user_badges har raden; radera rundan → raden är borta.
 * Riktig evaluateBadges och riktig computeBadgeTiers/diffBadgeTiers (inte mockade), mot fakeDb.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../services/levelService.js', () => ({ getLevelFromXP: vi.fn(async () => 1) }));
vi.mock('../../services/challengeService.js', () => ({ reconcileTokensForLevel: vi.fn(async () => undefined) }));
vi.mock('../../services/enhancedTitleService.js', () => ({
  EnhancedTitleService: class { processAllUsersTitles = vi.fn(async () => undefined); },
}));

import { getSupabaseClient } from '../../config/database.js';
import { calculateUserTotals } from '../calculateUserTotals.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

beforeEach(() => { vi.clearAllMocks(); });

describe('flöde 9: calculateUserTotals → user_badges (riktig evaluateBadges)', () => {
  it('logga 5 km-runda → user_badges har Milestoner tier 1; radera rundan → raden är borta', async () => {
    const t: Record<string, Row[]> = {
      activity_log: [],
      user_badges: [],
      users: [{ id: 'u1', group_id: 'g1', event_xp: 0, current_level: 1, total_km: 0, total_xp: 0, current_streak: 0, longest_streak: 0, displayed_badge_series: [] }],
      runs: [{ id: 'r1', user_id: 'u1', date: '2020-01-01', distance: 5, xp_gained: 10, start_time: null, moving_time: null, total_elevation_gain: null, is_treadmill: false, source: 'manual' }],
    };
    const db = createFakeDb(t, { numericIds: ['activity_log'] });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);

    await calculateUserTotals('u1');
    const milestoner = t.user_badges.filter((b) => b.user_id === 'u1' && b.series === 'milestoner');
    expect(milestoner).toHaveLength(1);
    expect(milestoner[0]).toMatchObject({ tier: 1, seen_tier: 0, source_run_id: 'r1' });

    t.runs = []; // rundan raderas → noll-rundor-vägen
    await calculateUserTotals('u1');
    expect(t.user_badges.filter((b) => b.series === 'milestoner')).toHaveLength(0);
  });
});
