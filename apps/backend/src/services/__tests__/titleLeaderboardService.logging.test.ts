/**
 * Loggarna (Railway sparar dem) får inte innehålla raderna ur title_leaderboard_view (namn, kön, värden) — bara antalet.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { inspect } from 'node:util';

const holder = vi.hoisted(() => ({ client: null as any }));

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { get client() { return holder.client; } },
  getSupabaseClient: vi.fn(() => holder.client),
}));

import { TitleLeaderboardService } from '../titleLeaderboardService.js';
import { createFakeDb } from '../../routes/__tests__/helpers/fakeDb.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('TitleLeaderboardService.getTitleLeaderboard — loggning', () => {
  it('loggar antalet rader men aldrig radernas innehåll', async () => {
    holder.client = createFakeDb({
      titles: [{ id: 't1', name: 'Early Bird', description: 'd', unlock_requirement: 1, metric_key: 'm' }],
      title_leaderboard_view: [
        { title_id: 't1', title_name: 'Early Bird', title_description: 'd', unlock_requirement: 'u', metric_key: 'm', position: 1, user_id: 'u1', user_name: 'Hemlig Löpare', user_gender: 'female', profile_picture: null, value: 4242.5, earned_at: '2026-10-01', group_id: 'g1' },
        { title_id: 't1', title_name: 'Early Bird', title_description: 'd', unlock_requirement: 'u', metric_key: 'm', position: 2, user_id: 'u2', user_name: 'Annan Person', user_gender: 'male', profile_picture: null, value: 3131.5, earned_at: '2026-10-02', group_id: 'g1' },
      ],
    }).client;
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));

    const result = await new TitleLeaderboardService().getTitleLeaderboard('g1');

    expect(result).toHaveLength(1);
    const out = spies.flatMap((s) => s.mock.calls).map((args: unknown[]) => args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 6 }))).join(' ')).join('\n');
    expect(out).toMatch(/2 rows/);
    expect(out).not.toContain('Hemlig Löpare');
    expect(out).not.toContain('Annan Person');
    expect(out).not.toContain('4242.5');
    expect(out).not.toContain('female');
  });
});
