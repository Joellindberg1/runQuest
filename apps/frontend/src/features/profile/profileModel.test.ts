import { describe, expect, it } from 'vitest';
import type { UserTitle } from '@runquest/types';
import type { TitleLeaderboard } from '@/shared/services/backendApi';
import {
  COMPACT_TITLE_COUNT, HISTORY_PREVIEW_COUNT, MAX_PICTURE_BYTES, buildMyTitles, buildRunRow, buildRunRows, buildUpdate, buildXpParts,
  deleteNotice, editFormFor, isDirty, showAllLabel, sortRuns, updateNotice, validateEdit, validatePicture,
} from './profileModel';
import { run } from './profile.fixture';

const TODAY = '2026-10-04';

describe('rundhistorik', () => {
  it('nyast först; samma dag → senast skapad först', () => {
    const a = run({ date: '2026-08-06', id: 'a' });
    const b = run({ date: '2026-08-21', id: 'b' });
    const c = run({ date: '2026-08-21', id: 'c', created_at: '2026-08-21T18:00:00Z' });
    const d = run({ date: '2026-08-21', id: 'd', created_at: '2026-08-21T07:00:00Z' });
    expect(sortRuns([a, b, d, c]).map((r) => r.id)).toEqual(['c', 'd', 'b', 'a']);
  });

  it('raden: datum, "km · underlag · streak day N", XP och multiplikator som i prototypen', () => {
    const row = buildRunRow(run({ date: '2026-08-21', distance: 10, streak_day: 4, xp_gained: 70, multiplier: 1.4 }));
    expect(row).toMatchObject({ date: '2026-08-21', meta: '10.0 km · outdoor · streak day 4', xp: '+70 XP', multiplier: '1.4×' });
  });

  it('löpband skrivs treadmill; okänt underlag (äldre manuella rundor) utelämnas i stället för att gissas', () => {
    expect(buildRunRow(run({ date: '2026-07-31', distance: 6, is_treadmill: true })).meta).toBe('6.0 km · treadmill · streak day 1');
    expect(buildRunRow(run({ date: '2026-07-31', distance: 6, is_treadmill: null })).meta).toBe('6.0 km · streak day 1');
  });

  it('datum med klockslag visas som dag', () => {
    expect(buildRunRows([run({ date: '2026-08-21T05:00:00Z' })])[0].date).toBe('2026-08-21');
  });

  it('"Show all N runs" bara när något är dolt', () => {
    expect(showAllLabel(HISTORY_PREVIEW_COUNT)).toBeNull();
    expect(showAllLabel(133)).toBe('Show all 133 runs');
    expect(showAllLabel(1200)).toBe('Show all 1 200 runs');
  });
});

describe('redigera en runda', () => {
  const original = run({ date: '2026-10-02', distance: 8.4 });

  it('formuläret startar med rundans datum och distans', () => {
    expect(editFormFor(original)).toEqual({ date: '2026-10-02', distance: '8.4' });
    expect(editFormFor(run({ date: '2026-10-02T05:00:00Z', distance: 10 }))).toEqual({ date: '2026-10-02', distance: '10' });
  });

  it('samma regler som Log/backend: minst 1.0 km, inte före 2025-06-01, inte framtida datum', () => {
    expect(validateEdit({ date: '2026-10-02', distance: '8,4' }, TODAY)).toEqual({});
    expect(validateEdit({ date: '2026-10-02', distance: '0.5' }, TODAY).distance).toMatch(/at least 1\.0 km/);
    expect(validateEdit({ date: '2026-10-02', distance: '' }, TODAY).distance).toBe('Enter a distance in km');
    expect(validateEdit({ date: '2026-10-02', distance: 'abc' }, TODAY).distance).toMatch(/must be a number/);
    expect(validateEdit({ date: '2025-05-31', distance: '8' }, TODAY).date).toMatch(/1 June 2025/);
    expect(validateEdit({ date: '2026-10-05', distance: '8' }, TODAY).date).toMatch(/future/);
    expect(validateEdit({ date: '', distance: '8' }, TODAY).date).toBe('Pick a date');
  });

  it('buildUpdate: det som skickas (komma → punkt) eller felen — inget anrop vid fel', () => {
    expect(buildUpdate({ date: '2026-10-03', distance: '8,4' }, TODAY, original)).toEqual({ ok: true, update: { date: '2026-10-03', distance: 8.4 } });
    const rejected = buildUpdate({ date: '2026-10-03', distance: '0.2' }, TODAY, original);
    expect(rejected.ok).toBe(false);
  });

  it('en ren distansändring utelämnar datumet — serverns UTC-"idag"-validering ska inte kunna fälla den', () => {
    expect(buildUpdate({ date: '2026-10-02', distance: '9' }, TODAY, original)).toEqual({ ok: true, update: { distance: 9 } });
    // Datum med klockslag i rundan räknas som sin dag.
    expect(buildUpdate({ date: '2026-10-02', distance: '9' }, TODAY, { date: '2026-10-02T05:00:00Z' })).toEqual({ ok: true, update: { distance: 9 } });
    // Ett ändrat datum skickas med.
    expect(buildUpdate({ date: '2026-10-01', distance: '9' }, TODAY, original)).toEqual({ ok: true, update: { date: '2026-10-01', distance: 9 } });
  });

  it('ett oförändrat datum valideras inte: distansen på en runda från före 2025-06-01 går att rätta', () => {
    expect(validateEdit({ date: '2025-05-20', distance: '9' }, TODAY, { date: '2025-05-20' })).toEqual({});
    expect(validateEdit({ date: '2025-05-21', distance: '9' }, TODAY, { date: '2025-05-20' }).date).toMatch(/1 June 2025/);
  });

  it('isDirty: något ändrat — datum eller distans — annars finns inget att spara', () => {
    expect(isDirty({ date: '2026-10-02', distance: '8.4' }, original)).toBe(false);
    expect(isDirty({ date: '2026-10-02', distance: '8,4' }, original)).toBe(false);
    expect(isDirty({ date: '2026-10-01', distance: '8.4' }, original)).toBe(true);
    expect(isDirty({ date: '2026-10-02', distance: '9' }, original)).toBe(true);
    expect(isDirty({ date: '2026-10-02', distance: 'x' }, original)).toBe(true);
  });

  it('bekräftelserna bär serverns siffror och säger att streak och XP räknas om', () => {
    expect(updateNotice({ date: '2026-10-02', distance: 8, xp_gained: 44 })).toBe('Run updated: 8.0 km on 2 Oct for 44 XP. Your streak and XP are recalculated from that day on.');
    expect(deleteNotice({ date: '2026-10-02', distance: 8.4 })).toBe('Run deleted: 8.4 km on 2 Oct. Your streak and XP are recalculated from that day on.');
  });

  it('uppräkningen i rutan: bas · distans · bonus · streak · total', () => {
    const parts = buildXpParts(run({ date: '2026-10-02', base_xp: 15, km_xp: 16, distance_bonus: 5, streak_bonus: 4, multiplier: 1.1, xp_gained: 40 }));
    expect(parts.map((part) => [part.key, part.label, part.value])).toEqual([
      ['base', 'Base', '15'],
      ['distance', 'Distance', '+16'],
      ['bonus', 'Distance bonus', '+5'],
      ['streak', 'Streak · 1.1×', '+4'],
      ['total', 'Total', '40 XP'],
    ]);
  });
});

describe('profilbild', () => {
  it('exakt serverns typer (jpeg, png, webp, gif) — inte alla image/*', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) expect(validatePicture({ size: 10, type })).toBeNull();
    for (const type of ['image/svg+xml', 'image/bmp', 'image/tiff', 'image/heic']) expect(validatePicture({ size: 10, type })).toBe('Only JPEG, PNG, WebP or GIF images are allowed');
  });

  it('bild, högst 5 MB', () => {
    expect(validatePicture({ size: 1000, type: 'image/png' })).toBeNull();
    expect(validatePicture({ size: MAX_PICTURE_BYTES, type: 'image/jpeg' })).toBeNull();
    expect(validatePicture({ size: MAX_PICTURE_BYTES + 1, type: 'image/png' })).toBe('The image must be smaller than 5 MB');
    expect(validatePicture({ size: 10, type: 'application/pdf' })).toBe('Only JPEG, PNG, WebP or GIF images are allowed');
    expect(validatePicture(undefined)).toBe('Choose an image to upload');
  });
});

describe('my titles', () => {
  const title = (id: string, over: Partial<UserTitle> = {}): UserTitle => ({
    title_id: id, title_name: `Title ${id}`, title_description: '', position: 1, value: 10, earned_at: '', is_current_holder: true, status: 'holder', ...over,
  });
  const board: TitleLeaderboard[] = [];
  const held = ['a', 'b', 'c', 'd', 'e'].map((id) => title(id));
  const runnersUp = [title('x', { is_current_holder: false, position: 2, status: 'runner_up' }), title('y', { is_current_holder: false, position: 3, status: 'runner_up' })];

  it('desktop: alla hållna och alla runner-up, sammanfattning "5 held · 2 runner-up"', () => {
    const view = buildMyTitles([...held, ...runnersUp], board, null, false, false);
    expect(view.held).toHaveLength(5);
    expect(view.runnersUp).toHaveLength(2);
    expect(view.summary).toBe('5 held · 2 runner-up');
    expect(view.showAllLabel).toBeNull();
  });

  it('mobil, ihopfälld: tre hållna och "Show all 7"; utfälld: allt', () => {
    const collapsed = buildMyTitles([...held, ...runnersUp], board, null, true, false);
    expect(collapsed.held).toHaveLength(COMPACT_TITLE_COUNT);
    expect(collapsed.runnersUp).toEqual([]);
    expect(collapsed.showAllLabel).toBe('Show all 7');

    const expanded = buildMyTitles([...held, ...runnersUp], board, null, true, true);
    expect(expanded.held).toHaveLength(5);
    expect(expanded.runnersUp).toHaveLength(2);
    expect(expanded.showAllLabel).toBeNull();
  });

  it('mobil med högst tre hållna och inga runner-up: inget att fälla ut', () => {
    expect(buildMyTitles(held.slice(0, 3), board, null, true, false).showAllLabel).toBeNull();
  });

  it('mobil med tre hållna men runner-up: knappen finns eftersom runner-up är dolda', () => {
    expect(buildMyTitles([...held.slice(0, 3), ...runnersUp], board, null, true, false).showAllLabel).toBe('Show all 5');
  });
});
