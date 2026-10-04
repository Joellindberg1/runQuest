import type { GroupRunHistoryItem } from '@runquest/shared';

// Testdata för Log (rundor ur GET /runs/group-history). Följer kontraktet i packages/shared — typen håller fixturen ärlig.

export const KARL = 'u-karl';
export const ME = 'u-me';

export function historyItem(over: Partial<GroupRunHistoryItem> = {}): GroupRunHistoryItem {
  return {
    id: 'r1',
    user_id: KARL,
    date: '2026-10-03',
    distance: 8.4,
    xp_gained: 51,
    multiplier: 1.6,
    streak_day: 8,
    base_xp: 15,
    km_xp: 16,
    distance_bonus: 5,
    streak_bonus: 10,
    source: 'strava',
    is_treadmill: false,
    weather_code: 2,
    temperature_c: 17.2,
    user_name: 'Karl Persson',
    user_level: 24,
    user_total_xp: 5539,
    user_profile_picture: undefined,
    start_time: '2026-10-03T06:10:00Z',
    created_at: '2026-10-03T07:00:00Z',
    ...over,
  };
}

export function historyPage(items: GroupRunHistoryItem[], total: number, offset = 0, limit = 10) {
  return {
    runs: items,
    meta: { total, limit, offset, has_more: offset + items.length < total },
  };
}
