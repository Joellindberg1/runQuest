/** RUN-99 T3 — countRunsWhere: gemensam räknare för "antal rundor som uppfyller villkoret". */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { countRunsWhere } from '../_utils.js';
import type { RunData } from '../types.js';

const run = (distance_km: number): RunData => ({ date: '2026-01-01', distance_km });

describe('countRunsWhere (RUN-99 T3)', () => {
  it('räknar rundor där villkoret är sant', () => {
    expect(countRunsWhere([run(1), run(5), run(10)], r => r.distance_km >= 5)).toBe(2);
  });
  it('tom lista → 0', () => {
    expect(countRunsWhere([], () => true)).toBe(0);
  });
});
