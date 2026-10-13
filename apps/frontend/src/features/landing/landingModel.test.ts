import { describe, expect, it } from 'vitest';
import { PREVIEW_RANK_DELTAS, PREVIEW_USERS } from '@/features/leaderboard/previewUsers';
import { formatInt } from '@/features/log/logFormat';
import { calculateRunXP, DEFAULT_ADMIN_SETTINGS } from '@runquest/shared';
import {
  ARENA, LANDING_NAV, PREVIEW_NOTES, PREVIEW_SIZE, STAT_PLACEHOLDER,
  buildFeatures, buildHowItWorks, buildPreviewRows, buildStatViews, buildXpFormula,
} from './landingModel';

describe('sifferraden', () => {
  const data = { runners: 6, challenges: 4, km: 4551 };

  it('ordningen är km (guld), löpare, utmaningar, med etiketterna km logged, runners och challenges', () => {
    expect(buildStatViews(data).map(({ key, tone, value, label }) => [key, tone, value, label])).toEqual([
      ['km', 'gold', formatInt(4551), 'km logged'],
      ['runners', 'plain', '6', 'runners'],
      ['challenges', 'plain', '4', 'challenges'],
    ]);
  });

  it('ett tal med värdet 1 får singular', () => {
    const labels = buildStatViews({ runners: 1, challenges: 1, km: 1 }).map((stat) => stat.label);
    expect(labels).toEqual(['km logged', 'runner', 'challenge']);
  });

  it('stora tal får mellanslag som tusentalsavgränsare', () => {
    const [km] = buildStatViews({ runners: 6, challenges: 4, km: 1_000_000 });
    expect(km.value).toBe(formatInt(1_000_000));
    expect(km.value).toMatch(/^1\s000\s000$/);
    expect(km.value).not.toMatch(/[,.]/);
  });

  it('noll visas som 0', () => {
    expect(buildStatViews({ runners: 0, challenges: 0, km: 0 }).map((stat) => stat.value)).toEqual(['0', '0', '0']);
    expect(buildStatViews({ runners: 0, challenges: 0, km: 0 }).map((stat) => stat.label)).toEqual(['km logged', 'runners', 'challenges']);
  });

  it('utan svar (laddar) är varje tal ett tankstreck men etiketterna står kvar', () => {
    const views = buildStatViews(undefined);
    expect(views.map((stat) => stat.value)).toEqual([STAT_PLACEHOLDER, STAT_PLACEHOLDER, STAT_PLACEHOLDER]);
    expect(views.map((stat) => stat.label)).toEqual(['km logged', 'runners', 'challenges']);
  });
});

describe('XP-formeln', () => {
  it('läser bas, km-faktor och streakintervall ur shared — ingen egen kopia', () => {
    const formula = buildXpFormula(
      { base_xp: 20, xp_per_km: 3, bonus_5km: 0, bonus_10km: 4, bonus_15km: 0, bonus_20km: 0, min_run_distance: 1 },
      [{ days: 3, multiplier: 1.2 }, { days: 9, multiplier: 1.5 }],
    );
    expect(formula.terms).toEqual(['Base 20', 'km × 3', 'Distance bonus', 'Streak 1.0–1.5×']);
    expect(formula.example).toEqual({ km: 10, xp: 20 + 30 + 4 });
  });

  it('standardreglerna ger BASE 15, KM × 2 och STREAK 1.0–2.0×', () => {
    expect(buildXpFormula().terms).toEqual(['Base 15', 'km × 2', 'Distance bonus', 'Streak 1.0–2.0×']);
  });

  it('formelexemplet 10 km ger +50 XP med standardreglerna', () => {
    const { example } = buildXpFormula();
    expect(example).toEqual({ km: 10, xp: 50 });
    expect(example.xp).toBe(calculateRunXP(example.km, DEFAULT_ADMIN_SETTINGS).totalXP);
  });

  it('textversionen för skärmläsare säger samma sak i en mening, med talen ur reglerna', () => {
    expect(buildXpFormula().spoken).toBe('Base 15 plus 2 per km plus distance bonus, times a streak multiplier from 1.0 to 2.0');
    expect(buildXpFormula({ ...DEFAULT_ADMIN_SETTINGS, base_xp: 25 }, [{ days: 2, multiplier: 1.4 }]).spoken).toContain('Base 25 plus 2 per km');
  });

  it('en tom streak-trappa ger intervallet 1.0–1.0 i stället för att krascha', () => {
    expect(buildXpFormula(undefined, []).terms[3]).toBe('Streak 1.0–1.0×');
  });
});

describe('funktionsrutnätet', () => {
  const cards = buildFeatures();

  it('sex kort numrerade 01–06 i den ordning designen har dem', () => {
    expect(cards).toHaveLength(6);
    expect(cards.map((card) => [card.tag, card.title])).toEqual([
      ['01', 'Leaderboard'], ['02', 'Titles'], ['03', 'Challenges'], ['04', 'Events'], ['05', 'Strava sync'], ['06', 'The journey'],
    ]);
  });

  it('Strava-kortet säger var 30:e minut och inte tre timmar', () => {
    const strava = cards[4].body;
    expect(strava).toBe('Runs import automatically every 30 minutes. Nothing to log by hand.');
    expect(strava).not.toMatch(/three hours|3 hours/i);
  });

  it('journey-kortet säger inte walked', () => {
    expect(cards[5].body).toBe('Your total distance mapped as a route with checkpoints, so the km add up to something.');
    expect(cards.map((card) => card.body).join(' ')).not.toMatch(/walked/i);
  });
});

describe('texterna runt previewkortet', () => {
  it('tre förklaringar; den tredje handlar om events som ger lätt XP, inte om en nedräkning', () => {
    expect(PREVIEW_NOTES.map((note) => note.title)).toEqual(['Rank changes show up', 'Levels, not just totals', 'Events give easy XP']);
    expect(PREVIEW_NOTES[2].body).toBe('Recurring events open on a schedule; join one and the XP lands on the board.');
    expect(JSON.stringify(PREVIEW_NOTES)).not.toMatch(/countdown|Göteborgsvarvet|Wolfpack/i);
  });

  it('ankarlänkarna i navigeringen pekar på filmen, How it works och funktionerna', () => {
    expect(LANDING_NAV).toEqual([
      { label: 'The game', id: 'film' },
      { label: 'XP & levels', id: 'how-it-works' },
      { label: 'Titles', id: 'features' },
    ]);
  });
});

describe('arenabanan', () => {
  const lanePathShape = /^M340 \d+ H1060 A\d+ \d+ 0 0 1 1060 \d+ H340 A\d+ \d+ 0 0 1 340 \d+ Z$/;

  it('desktop: fem banor, lutning −31° och sex löpare med XP-pop (+50, +35, +25, +107, +30, +19)', () => {
    expect(ARENA.desktop.lanes).toHaveLength(5);
    expect(ARENA.desktop.tiltDeg).toBe(-31);
    expect(ARENA.desktop.runners).toHaveLength(6);
    expect(ARENA.desktop.runners.map((runner) => runner.pop?.label)).toEqual(['+50 XP', '+35 XP', '+25 XP', '+107 XP', '+30 XP', '+19 XP']);
    for (const lane of ARENA.desktop.lanes) expect(lane.path).toMatch(lanePathShape);
    expect(ARENA.desktop.lanes[0].path).toBe('M340 230 H1060 A150 150 0 0 1 1060 530 H340 A150 150 0 0 1 340 230 Z');
    expect(ARENA.desktop.lanes[4].path).toBe('M340 126 H1060 A254 254 0 0 1 1060 634 H340 A254 254 0 0 1 340 126 Z');
  });

  it('mobil: tre banor, lutning −72°, tre löpare och en enda pop (+50 XP) för guldlöparen', () => {
    expect(ARENA.mobile.lanes).toHaveLength(3);
    expect(ARENA.mobile.tiltDeg).toBe(-72);
    expect(ARENA.mobile.runners).toHaveLength(3);
    expect(ARENA.mobile.runners.map((runner) => runner.pop?.label ?? null)).toEqual(['+50 XP', null, null]);
    expect(ARENA.mobile.lanes[1].path).toBe('M340 190 H1060 A190 190 0 0 1 1060 570 H340 A190 190 0 0 1 340 190 Z');
  });

  it('varje löpare går på en bana som finns, och banorna blir tydligare ju närmare innerbanan', () => {
    for (const variant of [ARENA.desktop, ARENA.mobile]) {
      const laneNumbers = variant.lanes.map((lane) => lane.lane);
      for (const runner of variant.runners) expect(laneNumbers).toContain(runner.lane);
      const alphas = variant.lanes.map((lane) => lane.alpha);
      expect(alphas).toEqual([...alphas].sort((a, b) => b - a));
    }
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

