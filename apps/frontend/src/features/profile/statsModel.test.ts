import { describe, expect, it } from 'vitest';
import { buildDistanceRows, buildFunRows, buildStreakRows, longestGapDays, STAT_VIEWS } from './statsModel';
import { run, user } from './profile.fixture';

// Fast klocka: söndag 2026-10-04 12:00 Stockholm.
const NOW = new Date('2026-10-04T10:00:00Z');

describe('statflikarna', () => {
  it('fyra flikar i designens ordning, Consistency sist', () => {
    expect([...STAT_VIEWS]).toEqual(['distance', 'streak', 'fun', 'consistency']);
  });
});

describe('longestGapDays', () => {
  it('dagar mellan två rundors datum — två dagar i rad är 1', () => {
    expect(longestGapDays([run({ date: '2026-08-01' }), run({ date: '2026-08-02' }), run({ date: '2026-08-21' }), run({ date: '2026-08-22' })])).toBe(19);
  });

  it('flera rundor samma dag räknas som en löpardag', () => {
    expect(longestGapDays([run({ date: '2026-08-01' }), run({ date: '2026-08-01' }), run({ date: '2026-08-04' })])).toBe(3);
  });

  it('färre än två löpardagar ger inget uppehåll', () => {
    expect(longestGapDays([])).toBeNull();
    expect(longestGapDays([run({ date: '2026-08-01' }), run({ date: '2026-08-01' })])).toBeNull();
  });

  it('tiden sedan senaste rundan räknas inte (uppehållet är inte slut)', () => {
    expect(longestGapDays([run({ date: '2026-01-01' }), run({ date: '2026-01-03' })])).toBe(2);
  });

  it('datum med klockslag jämförs på dagen', () => {
    expect(longestGapDays([run({ date: '2026-08-01T05:00:00Z' }), run({ date: '2026-08-05T22:00:00Z' })])).toBe(4);
  });
});

describe('buildFunRows — profilens egna rader', () => {
  const me = user({
    id: 'u-me', name: 'Joel', total_xp: 100, total_km: 100,
    runs: [run({ date: '2026-01-04', distance: 30 }), run({ date: '2026-08-21', distance: 12 }), run({ date: '2026-08-28', distance: 12 })],
  });

  it('maratonekvivalenter (totalt och i år), längsta uppehåll och favoritdag — inte Runner cards "Double-run days"', () => {
    const rows = buildFunRows(me, NOW);
    expect(rows.map((row) => row.label)).toEqual(['Marathon equivalents total', 'Marathon equivalents 2026', 'Longest gap between runs', 'Favourite day to run']);
    // 100 km = 2 maraton; i år 54 km = 1; 4 jan → 21 aug = 229 dagar; två fredagar mot en söndag.
    expect(rows.map((row) => row.value)).toEqual(['2', '1', '229 days', 'Friday']);
    expect(rows[2].tone).toBe('muted');
    expect(rows[3].tone).toBe('gold');
  });

  it('utan rundor: streck i stället för påhittade värden', () => {
    const rows = buildFunRows(user({ id: 'x', name: 'X', total_xp: 0, total_km: 0 }), NOW);
    expect(rows.map((row) => row.value)).toEqual(['0', '0', '—', '—']);
  });
});

describe('Distance och Streak delas med Runner card', () => {
  it('samma rader (EN definition i runnerModel)', () => {
    const me = user({ id: 'u-me', name: 'Joel', total_xp: 1, total_km: 20, current_streak: 2, longest_streak: 9, runs: [run({ date: '2026-10-04', distance: 10 }), run({ date: '2026-10-03', distance: 10 })] });
    expect(buildDistanceRows(me, NOW).map((row) => row.label)).toEqual(['Longest run', 'Total', 'Average per run', 'This month']);
    expect(buildStreakRows(me, NOW, [{ days: 3, multiplier: 1.3 }]).map((row) => row.label)).toEqual(['Current', 'Best', 'Multiplier', 'Next tier at']);
  });
});
