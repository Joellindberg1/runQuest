import { describe, expect, it } from 'vitest';
import type { AdminUser } from '@/shared/services/backendApi';
import {
  MULTIPLIER_MAX, MULTIPLIER_MIN, XP_GROUPS, fieldValue, findSettingsProblem, memberCountText, memberMeta, multiplierRows, parseField,
} from './adminModel';
import type { AdminSettings } from './hooks/useAdminData';

const SETTINGS: AdminSettings = {
  xpPerRun: 15, xpPerKm: 2, bonus5km: 5, bonus10km: 15, bonus15km: 25, bonus20km: 50, minKmForRun: 1, minKmForStreak: 1,
  minRunDate: '2025-06-01', streakBonuses: {}, multipliers: { 21: 2, 3: 1.3, 7: 1.5 },
};

describe('XP_GROUPS', () => {
  it('Basic XP och Distance bonuses i prototypens ordning, med de fält Save faktiskt skickar som redigerbara', () => {
    expect(XP_GROUPS.map((group) => group.title)).toEqual(['Basic XP', 'Distance bonuses']);
    const editable = XP_GROUPS.flatMap((group) => group.fields).filter((field) => field.editable).map((field) => field.key);
    expect(editable).toEqual(['xpPerRun', 'xpPerKm', 'minKmForRun', 'bonus5km', 'bonus10km', 'bonus15km', 'bonus20km']);
  });

  it('det Save inte skickar (streak-minimum, datum) är skrivskyddat i stället för att låtsas gå att ändra', () => {
    const fixed = XP_GROUPS.flatMap((group) => group.fields).filter((field) => !field.editable).map((field) => field.key);
    expect(fixed).toEqual(['minKmForStreak', 'minRunDate']);
  });
});

describe('parseField / fieldValue', () => {
  it('heltal och decimaler; ett tomt fält är NaN (inte 0)', () => {
    expect(parseField('20', 'int')).toBe(20);
    expect(parseField('1.5', 'decimal')).toBe(1.5);
    expect(parseField('', 'int')).toBeNaN();
    expect(parseField('  ', 'decimal')).toBeNaN();
  });

  it('ett ogiltigt värde visas som ett tomt fält, aldrig som "NaN"', () => {
    expect(fieldValue(Number.NaN)).toBe('');
    expect(fieldValue(2)).toBe(2);
  });
});

describe('multiplierRows', () => {
  it('trappan i stigande dagordning med etiketter', () => {
    expect(multiplierRows(SETTINGS.multipliers)).toEqual([
      { days: 3, multiplier: 1.3, label: '3 days' },
      { days: 7, multiplier: 1.5, label: '7 days' },
      { days: 21, multiplier: 2, label: '21 days' },
    ]);
  });

  it('en dag är singular', () => {
    expect(multiplierRows({ 1: 1.1 })[0].label).toBe('1 day');
  });

  it('gränserna speglar backend (numeric(3,2): 1–9.99)', () => {
    expect([MULTIPLIER_MIN, MULTIPLIER_MAX]).toEqual([1, 9.99]);
  });
});

describe('findSettingsProblem', () => {
  it('giltiga inställningar: inget problem', () => {
    expect(findSettingsProblem(SETTINGS)).toBeNull();
  });

  it('ett tomt fält eller ett tomt trappsteg stoppas', () => {
    expect(findSettingsProblem({ ...SETTINGS, xpPerKm: Number.NaN })).toMatch(/needs a number/);
    expect(findSettingsProblem({ ...SETTINGS, multipliers: { 3: Number.NaN } })).toMatch(/needs a number/);
  });

  it('gränserna (t.ex. multiplikator över 9.99) lämnas åt servern — 400-svaret visas ordagrant', () => {
    expect(findSettingsProblem({ ...SETTINGS, multipliers: { 3: 12.5 } })).toBeNull();
  });
});

describe('memberMeta / memberCountText', () => {
  const user = { current_level: 24, total_xp: 5539, total_runs: 159, current_streak: 8 } as AdminUser;

  it('"Level 24 · 5 539 XP · 159 runs · 8 streak" med tusentalsmellanrum', () => {
    expect(memberMeta(user)).toBe('Level 24 · 5 539 XP · 159 runs · 8 streak');
  });

  it('medlemsantalet i singular och plural', () => {
    expect(memberCountText(1)).toBe('1 member');
    expect(memberCountText(6)).toBe('6 members');
    expect(memberCountText(0)).toBe('0 members');
  });
});
