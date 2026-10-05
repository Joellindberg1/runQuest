import { describe, expect, it } from 'vitest';
import { DEFAULT_ADMIN_SETTINGS, DEFAULT_STREAK_MULTIPLIERS } from '@runquest/shared';
import type { XpRules } from '@/features/log/xpPreviewModel';
import { CHAPTER_IDS, LEVEL_MILESTONES, buildChapters, neighbours, type Chapter, type ChapterId } from './playbookModel';

// Reglerna är medvetet INTE produktionens: kapitlen ska läsa siffrorna ur konfigurationen, inte ur kod.
const RULES: XpRules = {
  settings: { base_xp: 20, xp_per_km: 3, bonus_5km: 7, bonus_10km: 17, bonus_15km: 27, bonus_20km: 57, min_run_distance: 1.5 },
  streak_multipliers: [{ days: 3, multiplier: 1.3 }, { days: 7, multiplier: 1.5 }, { days: 21, multiplier: 2 }],
};

const chapter = (id: ChapterId, rules: XpRules = RULES): Chapter => {
  const found = buildChapters(rules).find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no chapter ${id}`);
  return found;
};
const rowsOf = (id: ChapterId, rules?: XpRules) => (chapter(id, rules).table?.rows ?? []).map((row) => [row.label, row.value]);

describe('buildChapters', () => {
  it('nio kapitel i prototypens ordning, numrerade 01–09 med unika id:n', () => {
    const chapters = buildChapters(RULES);
    expect(chapters.map((c) => c.id)).toEqual([...CHAPTER_IDS]);
    expect(chapters.map((c) => c.num)).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09']);
    expect(chapters.map((c) => c.label)).toEqual([
      'What counts as a run', 'The XP formula', 'Streaks', 'Levels', 'Titles', 'Challenges', 'Events', 'Frodo’s journey', 'Fair play',
    ]);
    for (const c of chapters) expect({ id: c.id, lead: c.lead.length > 0, paras: c.paras.length > 0 }).toEqual({ id: c.id, lead: true, paras: true });
  });

  it('endast titelkapitlet visar titellistan ur databasen', () => {
    expect(buildChapters(RULES).filter((c) => c.showsTitleList).map((c) => c.id)).toEqual(['titles']);
  });
});

describe('XP & running — siffrorna kommer ur konfigurationen', () => {
  it('kapitel 1: manuell miniminivå 1.0 km (appens konstant), Strava utan gräns, och basen från konfigurationens min_run_distance', () => {
    expect(chapter('run').lead).toBe('Manual runs need at least 1.0 km; runs synced from Strava count at any distance.');
    expect(rowsOf('run').slice(0, 2)).toEqual([['Manual run, minimum', '1.0 km'], ['Base XP from', '1.5 km']]);
    expect(chapter('xp').paras.join(' ')).toContain('The base is paid from 1.5 km.');
  });

  it('formeln: ingress och tabell följer base, XP/km och distansbonusarna', () => {
    expect(chapter('xp').lead).toBe('Base 20, plus 3 XP per kilometre, plus a distance bonus. Your streak multiplies the first two.');
    expect(rowsOf('xp')).toEqual([
      ['Base per run', '20'], ['Per kilometre', '× 3'], ['From 5 km', '+7'], ['From 10 km', '+17'], ['From 15 km', '+27'], ['From 20 km', '+57'],
    ]);
  });

  it('räkneexemplen är shareds formel över samma konfiguration (5 km: 20 + 15 + 7 = 42, 10 km: 20 + 30 + 17 = 67)', () => {
    const text = chapter('xp').paras.join(' ');
    expect(text).toContain('20 + 15 + 7 = 42 XP');
    expect(text).toContain('20 + 30 + 17 = 67 XP');
  });

  it('standardvärdena ger dagens siffror (15 · 2 · 5/15/25/50)', () => {
    const defaults: XpRules = { settings: DEFAULT_ADMIN_SETTINGS, streak_multipliers: DEFAULT_STREAK_MULTIPLIERS };
    expect(rowsOf('xp', defaults)).toEqual([
      ['Base per run', '15'], ['Per kilometre', '× 2'], ['From 5 km', '+5'], ['From 10 km', '+15'], ['From 15 km', '+25'], ['From 20 km', '+50'],
    ]);
    expect(chapter('xp', defaults).paras.join(' ')).toContain('15 + 10 + 5 = 30 XP');
  });
});

describe('Streaks — trappan kommer ur konfigurationen', () => {
  it('raderna är trappans steg i dagordning: från vilken dag och vilken multiplikator', () => {
    expect(rowsOf('streaks')).toEqual([['From day 3', '1.3×'], ['From day 7', '1.5×'], ['From day 21', '2×']]);
  });

  it('noten är en verklig beräkning: (base + km) × multiplikator + distansbonus, avrundat nedåt', () => {
    const notes = chapter('streaks').table?.rows.map((row) => row.note);
    // (20 + 15) × 1.3 = 45.5 + 7 = 52.5 → 52 · × 1.5 = 52.5 + 7 = 59.5 → 59 · × 2 = 70 + 7 = 77
    expect(notes).toEqual(['5 km run: 52 XP', '5 km run: 59 XP', '5 km run: 77 XP']);
  });

  it('ingressen går till trappans högsta steg och exemplet jämför med rundan utan streak', () => {
    const streaks = chapter('streaks');
    expect(streaks.lead).toContain('up to 2×');
    expect(streaks.paras.join(' ')).toContain('At 2× a 5 km run is worth 77 XP instead of 42.');
  });

  it('trappan sorteras även om den kommer i fel ordning', () => {
    const shuffled: XpRules = { ...RULES, streak_multipliers: [...RULES.streak_multipliers].reverse() };
    expect(rowsOf('streaks', shuffled).map(([label]) => label)).toEqual(['From day 3', 'From day 7', 'From day 21']);
  });

  it('en tom trappa ger ingen tabell och ingen påhittad toppmultiplikator', () => {
    const none: XpRules = { ...RULES, streak_multipliers: [] };
    expect(chapter('streaks', none).table).toBeNull();
    expect(chapter('streaks', none).lead).not.toMatch(/up to/);
  });
});

describe('Levels', () => {
  it('tabellen är milstolparna ur shareds nivåtabell, med XP och hur många rundor det motsvarar', () => {
    const rows = chapter('levels').table?.rows ?? [];
    expect(rows.map((row) => row.label)).toEqual(LEVEL_MILESTONES.map((level) => `Level ${level}`));
    const level10 = rows.find((row) => row.label === 'Level 10');
    expect(level10?.value).toBe('594 XP');
    // 594 / 42 = 14.1 runs av 5 km, 594 / 67 = 8.9 av 10 km — med dagens konfiguration (inte 30/50 som tidigare hårdkodat)
    expect(level10?.note).toBe('14.1 runs of 5 km · 8.9 of 10 km');
  });

  it('tusental med mellanrum och en egen nivåtabell respekteras', () => {
    const rows = buildChapters(RULES, [{ level: 30, xp_required: 16071 }, { level: 2, xp_required: 50 }]).find((c) => c.id === 'levels')?.table?.rows ?? [];
    expect(rows.map((row) => row.value)).toEqual(['50 XP', '16 071 XP']);
  });
});

describe('Challenges, Events, Frodo', () => {
  it('insatserna per nivå kommer ur challenges-featurens seed (en definition)', () => {
    expect(rowsOf('challenges')).toEqual([
      ['Minor · win', '+0.15× / 5 d'], ['Minor · lose', '−0.07× / 5 d'],
      ['Major · win', '+0.25× / 10 d'], ['Major · lose', '−0.12× / 10 d'],
      ['Legendary · win', '+0.5× / 14 d'], ['Legendary · lose', '−0.25× / 14 d'],
    ]);
  });

  it('events: sex deltagarevent (inkl. Half Marathon Chaser) med fönster och XP', () => {
    const rows = chapter('events').table?.rows ?? [];
    expect(rows.map((row) => row.label)).toEqual(['Morgonrunda', 'Kvällsrunda', '5K Friday', 'Half Marathon Chaser', 'Hangover Run', 'Storm Chaser']);
    expect(rows.every((row) => row.note && /^\+\d+$/.test(row.value))).toBe(true);
  });

  it('Frodo: sträckan och de sju stora målen ur samma waypoint-lista som Profile', () => {
    expect(chapter('frodo').lead).toContain('3 266 km');
    const rows = rowsOf('frodo');
    expect(rows[0]).toEqual(['The Shire', '0 km']);
    expect(rows[rows.length - 1]).toEqual(['Mount Doom', '3 266 km']);
    expect(rows).toHaveLength(7);
  });
});

describe('neighbours', () => {
  const chapters = buildChapters(RULES);

  it('föregående, nästa och position', () => {
    expect(neighbours(chapters, 'streaks')).toMatchObject({ prev: { id: 'xp' }, next: { id: 'levels' }, position: '3 / 9' });
  });

  it('går runt i ändarna som prototypen (Fair play ← första → andra)', () => {
    expect(neighbours(chapters, 'run').prev.id).toBe('fair-play');
    expect(neighbours(chapters, 'fair-play').next.id).toBe('run');
  });
});
