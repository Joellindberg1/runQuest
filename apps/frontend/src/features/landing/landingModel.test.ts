import { describe, expect, it } from 'vitest';
import { PREVIEW_RANK_DELTAS, PREVIEW_USERS } from '@/features/leaderboard/previewUsers';
import { formatInt } from '@/features/log/logFormat';
import {
  ARENA_LANES, COUNT_UP_MS, LANDING_STATS, PREVIEW_SIZE, buildHowItWorks, buildPreviewRows, countUpProgress, countUpValue,
} from './landingModel';

describe('uppräkningen', () => {
  it('börjar på 0, slutar på exakt 1 och går aldrig utanför 0–1', () => {
    expect(countUpProgress(0)).toBe(0);
    expect(countUpProgress(COUNT_UP_MS)).toBe(1);
    expect(countUpProgress(COUNT_UP_MS * 5)).toBe(1);
    expect(countUpProgress(-300)).toBe(0);
  });

  it('är ease-out: halva tiden ger mer än halva vägen, och stegen bara växer', () => {
    expect(countUpProgress(COUNT_UP_MS / 2)).toBeGreaterThan(0.5);
    let previous = -1;
    for (let t = 0; t <= COUNT_UP_MS; t += COUNT_UP_MS / 20) {
      const value = countUpProgress(t);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('längd 0 hoppar direkt till slutet (inget delat med noll)', () => {
    expect(countUpProgress(0, 0)).toBe(1);
  });

  it('värdet är ett heltal och sista steget är exakt målet', () => {
    expect(countUpValue(128_430, 0)).toBe(0);
    expect(Number.isInteger(countUpValue(9_412, 0.333))).toBe(true);
    expect(countUpValue(1_284_600, 1)).toBe(1_284_600);
    expect(countUpValue(100, -1)).toBe(0);
  });

  it('aggregaten är hårdskrivna exempelsiffror (ägarbeslut 4): km, runs, XP', () => {
    expect(LANDING_STATS.map((stat) => [stat.label, stat.value])).toEqual([['km', 128_430], ['runs', 9_412], ['XP', 1_284_600]]);
  });
});

describe('previewkortet', () => {
  const rows = buildPreviewRows(PREVIEW_USERS, PREVIEW_RANK_DELTAS);

  it('visar topp fem i Boards ordning, med plats 1–5', () => {
    expect(rows).toHaveLength(PREVIEW_SIZE);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.map((row) => row.name)).toEqual(['Anna', 'Erik', 'Maria', 'Johan', 'Sara']);
  });

  it('visar bara förnamn (anonymiserad), aldrig efternamn eller id', () => {
    for (const row of rows) expect(row.name).not.toMatch(/\s/);
    expect(JSON.stringify(rows)).not.toMatch(/Lindqvist|Svensson|Johansson|Karlsson|Nilsson/);
  });

  it('XP formateras med tusentalsmellanrum och stapeln är XP relativt etta', () => {
    expect(rows[0]).toMatchObject({ xp: formatInt(8420), pct: 100 });
    expect(rows[0].xp).toMatch(/^8\s420$/);
    expect(rows.map((row) => row.pct)).toEqual([...rows.map((row) => row.pct)].sort((a, b) => b - a));
    expect(rows[4].pct).toBe(Math.round((4100 / 8420) * 100));
  });

  it('rank-pilarna kommer ur samma data som preview-sidan (null = ingen förändring)', () => {
    expect(rows.map((row) => row.delta.direction)).toEqual(['up', 'down', 'flat', 'up', 'flat']);
    expect(rows[3].delta.text).toBe('▲ 2');
  });

  it('plats 1–3 får rankfärg, 4+ är "rest"; stapeln startar förskjutet per plats', () => {
    expect(rows.map((row) => row.tone)).toEqual(['1', '2', '3', 'rest', 'rest']);
    expect(rows.map((row) => row.delay)).toEqual(['0.1s', '0.2s', '0.3s', '0.4s', '0.5s']);
  });

  it('tom flock → inga rader (ingen division med noll)', () => {
    expect(buildPreviewRows([], {})).toEqual([]);
  });

  it('en flock med färre än fem visar de som finns', () => {
    expect(buildPreviewRows(PREVIEW_USERS.slice(0, 2), PREVIEW_RANK_DELTAS)).toHaveLength(2);
  });
});

describe('How it works', () => {
  it('fyra numrerade steg i den ordning prototypen har dem', () => {
    const steps = buildHowItWorks();
    expect(steps.map((step) => [step.num, step.title])).toEqual([
      ['01', 'Log the run'], ['02', 'Earn XP'], ['03', 'Keep the streak'], ['04', 'Take the title'],
    ]);
  });

  it('XP-texten följer shared-standardreglerna (15 + 2 per km, bonus vid 5/10/15/20 km)', () => {
    expect(buildHowItWorks()[1].body).toBe('Base 15 plus 2 per km, with bonus XP at 5, 10, 15 and 20 km. Same formula for everyone.');
  });

  it('streak-texten visar spelets VERKLIGA trappa (ägarbeslut 1): från dag 5 (×1.1) upp till ×2.0 vid dag 270', () => {
    const body = buildHowItWorks()[2].body;
    expect(body).toContain('from day 5 (×1.1)');
    expect(body).toContain('×2.0 at day 270');
    expect(body).not.toMatch(/resets to 1/);
  });

  it('siffrorna kommer ur inställningarna som skickas in — ingen egen kopia', () => {
    const steps = buildHowItWorks(
      { base_xp: 20, xp_per_km: 3, bonus_5km: 0, bonus_10km: 0, bonus_15km: 0, bonus_20km: 0, min_run_distance: 1 },
      [{ days: 3, multiplier: 1.2 }, { days: 9, multiplier: 1.5 }],
    );
    expect(steps[1].body).toContain('Base 20 plus 3 per km');
    expect(steps[2].body).toContain('from day 3 (×1.2)');
    expect(steps[2].body).toContain('×1.5 at day 9');
  });

  it('tom streak-trappa ger en text utan siffror i stället för att krascha', () => {
    expect(buildHowItWorks(undefined, [])[2].body).toMatch(/multiplier grows/);
  });
});

describe('arenabanan', () => {
  it('tre banor — guld (innersta), silver, brons (yttersta) — som stängda ovaler', () => {
    expect(ARENA_LANES.map((lane) => lane.lane)).toEqual([1, 2, 3]);
    for (const lane of ARENA_LANES) expect(lane.path).toMatch(/^M340 \d+ H1060 A\d+ \d+ 0 0 1 1060 \d+ H340 A\d+ \d+ 0 0 1 340 \d+ Z$/);
    expect(ARENA_LANES[0].path).toBe('M340 230 H1060 A150 150 0 0 1 1060 530 H340 A150 150 0 0 1 340 230 Z');
    const radii = ARENA_LANES.map((lane) => lane.runnerRadius);
    expect(radii).toEqual([...radii].sort((a, b) => b - a));
  });
});
