import { describe, expect, it } from 'vitest';
import { DEFAULT_ADMIN_SETTINGS, DEFAULT_STREAK_MULTIPLIERS, calculateCompleteRunXP } from '@runquest/shared';
import { ME, OTHER, XP_CONFIG } from '@/test/fakeBackend';
import { buildXpPreview, type PreviewInput } from './xpPreviewModel';

const TODAY = '2026-10-04';
const run = (date: string, streak_day: number) => ({ date, streak_day }) as never;

// Jag: 5243 XP (nivå 24, 659 kvar till 25), 943 km. Karl ligger före med 5539. Löpt igår (streakdag 4).
const me = { ...ME, runs: [run('2026-10-02', 3), run('2026-10-03', 4)] };
const karl = { ...OTHER };

const input = (over: Partial<PreviewInput> = {}): PreviewInput => ({
  km: 8,
  date: TODAY,
  today: TODAY,
  me,
  users: [me, karl],
  rules: XP_CONFIG,
  ...over,
});

const effect = (preview: ReturnType<typeof buildXpPreview>, key: string) => preview.effects.find((row) => row.key === key);
const row = (preview: ReturnType<typeof buildXpPreview>, key: string) => preview.rows.find((r) => r.key === key);

describe('buildXpPreview — uppställningen', () => {
  it('tom eller för kort distans: "—", dämpad uppställning och en uppmaning', () => {
    for (const km of [null, 0.5]) {
      const preview = buildXpPreview(input({ km }));
      expect(preview.ready).toBe(false);
      expect(preview.total).toBe('—');
      expect(preview.rows.map((r) => r.value)).toEqual(['15', '—', '—', '—']);
      expect(preview.effects).toEqual([{ key: 'hint', label: 'Enter a distance', value: 'min 1.0 km', tone: 'muted' }]);
    }
  });

  it('räknar med shared-formeln över config-trappan — streakdag 5 ger config-trappans multiplikator', () => {
    const preview = buildXpPreview(input());
    const expected = calculateCompleteRunXP(8, 5, XP_CONFIG.settings, XP_CONFIG.streak_multipliers);
    expect(expected.multiplier).toBe(1.3); // fixturens trappa (3 d → 1.3×), inte produktionens
    expect(preview.ready).toBe(true);
    expect(preview.totalXp).toBe(expected.finalXP);
    expect(preview.total).toBe(`~${expected.finalXP}`);
    expect(preview.rows).toEqual([
      { key: 'base', label: 'Base', value: '15', tone: 'default' },
      { key: 'distance', label: 'Distance · 8.0 km × 2', value: '+16', tone: 'default' },
      { key: 'bonus', label: 'Distance bonus', value: '+5', tone: 'up' },
      { key: 'streak', label: 'Streak · day 5', value: '×1.3', tone: 'gold' },
    ]);
  });

  it('inget hårdkodat: andra inställningar ger andra siffror', () => {
    const rules = { settings: { ...XP_CONFIG.settings, xp_per_km: 3, base_xp: 20 }, streak_multipliers: [{ days: 5, multiplier: 2 }] };
    const preview = buildXpPreview(input({ rules }));
    expect(row(preview, 'distance')).toMatchObject({ label: 'Distance · 8.0 km × 3', value: '+24' });
    expect(row(preview, 'base')?.value).toBe('20');
    expect(row(preview, 'streak')?.value).toBe('×2.0');
  });

  it('shareds standardvärden duger som reserv när config saknas', () => {
    const rules = { settings: DEFAULT_ADMIN_SETTINGS, streak_multipliers: DEFAULT_STREAK_MULTIPLIERS };
    const preview = buildXpPreview(input({ me: { ...me, runs: [] }, users: [{ ...me, runs: [] }], rules }));
    expect(preview.totalXp).toBe(calculateCompleteRunXP(8, 1, DEFAULT_ADMIN_SETTINGS, DEFAULT_STREAK_MULTIPLIERS).finalXP);
  });

  it('ingen streak: ×1.0 dämpat; ingen distansbonus under 5 km visas som 0', () => {
    const preview = buildXpPreview(input({ km: 3, me: { ...me, runs: [] }, users: [{ ...me, runs: [] }] }));
    expect(row(preview, 'streak')).toMatchObject({ label: 'Streak · day 1', value: '×1.0', tone: 'muted' });
    expect(row(preview, 'bonus')).toMatchObject({ value: '0', tone: 'muted' });
  });

  it('streakdagen följer datumet: en bakdaterad runda efter en lucka börjar om, och ett ogiltigt datum räknas som idag', () => {
    expect(row(buildXpPreview(input({ date: '2026-09-20' })), 'streak')?.label).toBe('Streak · day 1');
    expect(row(buildXpPreview(input({ date: '2026-10-09' })), 'streak')?.label).toBe('Streak · day 5');
  });
});

describe('buildXpPreview — "What this run does"', () => {
  it('streak: dagen efter min senaste runda håller den vid liv', () => {
    expect(effect(buildXpPreview(input()), 'streak')).toEqual({ key: 'streak', label: 'Streak', value: 'Stays alive · day 5', tone: 'up' });
  });

  it('streak: bakdaterad fortsättning, redan räknad dag och ny streak', () => {
    expect(effect(buildXpPreview(input({ date: '2026-10-03', me: { ...me, runs: [run('2026-10-02', 3)] } })), 'streak')?.value).toBe('Continues · day 4');
    expect(effect(buildXpPreview(input({ me: { ...me, runs: [run('2026-10-04', 5)] } })), 'streak')?.value).toBe('Already counted · day 5');
    expect(effect(buildXpPreview(input({ me: { ...me, runs: [run('2026-09-30', 8)] } })), 'streak')?.value).toBe('New streak · day 1');
  });

  it('nivå: kvar-XP efter rundan, och nivåuppgång när rundan räcker', () => {
    const preview = buildXpPreview(input());
    const gained = preview.totalXp ?? 0;
    expect(effect(preview, 'level')).toEqual({ key: 'level', label: 'Level 25', value: `${659 - gained} XP to go`, tone: 'default' });

    const close = { ...me, total_xp: 5890 };
    expect(effect(buildXpPreview(input({ me: close, users: [close, karl] })), 'level')).toEqual({ key: 'level', label: 'Level 25', value: 'Level up', tone: 'gold' });
  });

  it('Frodo: kilometer mot nästa mål, och "Reaches" när rundan passerar det', () => {
    expect(effect(buildXpPreview(input()), 'journey')?.value).toBe("+8.0 km toward Balin's Tomb");
    const near = { ...me, total_km: 1030 };
    expect(effect(buildXpPreview(input({ me: near, users: [near, karl] })), 'journey')).toEqual({
      key: 'journey', label: 'Frodo’s journey', value: "Reaches Balin's Tomb", tone: 'up',
    });
    const done = { ...me, total_km: 3300 };
    expect(effect(buildXpPreview(input({ me: done, users: [done, karl] })), 'journey')?.value).toBe('Journey complete');
  });

  it('ranking: närmar sig personen före, med glappet i XP', () => {
    const preview = buildXpPreview(input());
    const gained = preview.totalXp ?? 0;
    expect(effect(preview, 'board')).toEqual({ key: 'board', label: 'Leaderboard', value: `Closes on Karl · ${5539 - 5243 - gained} XP behind`, tone: 'up' });
  });

  it('ranking: passerar personen före, och flera i en rad', () => {
    const near = { ...me, total_xp: 5520 };
    expect(effect(buildXpPreview(input({ me: near, users: [near, karl] })), 'board')?.value).toBe('Passes Karl');

    const anna = { ...OTHER, id: 'u-anna', name: 'Anna Berg', total_xp: 5530 };
    expect(effect(buildXpPreview(input({ me: near, users: [near, karl, anna] })), 'board')?.value).toBe('Passes Anna and 1 more');
  });

  it('ranking: leder jag behåller jag förstaplatsen, med försprånget', () => {
    const leader = { ...me, total_xp: 5600 };
    const preview = buildXpPreview(input({ me: leader, users: [leader, karl] }));
    expect(effect(preview, 'board')).toEqual({
      key: 'board', label: 'Leaderboard', value: `Holds 1st · leads by ${5600 + (preview.totalXp ?? 0) - 5539} XP`, tone: 'gold',
    });
    expect(effect(buildXpPreview(input({ me: leader, users: [leader] })), 'board')?.value).toBe('Holds 1st');
  });

  it('ranking: utan plats på tavlan (admin) utelämnas raden', () => {
    const admin = { ...me, name: 'admin' };
    expect(effect(buildXpPreview(input({ me: admin, users: [admin, karl] })), 'board')).toBeUndefined();
  });

  it('en nivå som redan är max visas som Max level', () => {
    const max = { ...me, total_xp: 99999 };
    expect(effect(buildXpPreview(input({ me: max, users: [max, karl] })), 'level')).toMatchObject({ value: 'Max level', tone: 'gold' });
  });
});
