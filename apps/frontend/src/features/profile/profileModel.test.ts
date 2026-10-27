import { describe, expect, it } from 'vitest';
import {
  COMPACT_TITLE_COUNT, HISTORY_PREVIEW_COUNT, buildMyTitles, buildRunRow, buildRunRows, buildRunTime, buildRunTimeSummary, buildUpdate, buildXpParts,
  STRAVA_DELETE_HINT, deleteNotice, editFormFor, isDirty, isStravaRun, showAllLabel, sortRuns, updateNotice, validateEdit, validatePicture,
} from './profileModel';
import { run } from './profile.fixture';
import { PROFILE_PICTURE_MAX_BYTES, type TitleLeaderboardEntry, type UserTitleEntry } from '@runquest/shared';

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

describe('tid och tempo per rad', () => {
  it('en runda med tid: tid, tempo och skärmläsartext ur samma funktioner som alla vyer', () => {
    expect(buildRunTime(run({ date: '2026-08-21', distance: 10, moving_time: 3130 }))).toEqual({
      timed: true, time: '52:10', pace: '5:13 /km', label: 'Time 52:10, pace 5:13 per kilometre',
    });
  });

  it('tider från en timme läses med ord, den synliga texten är h:mm:ss', () => {
    const cell = buildRunTime(run({ date: '2026-08-21', distance: 12, moving_time: 4180 }));
    expect(cell.time).toBe('1:09:40');
    expect(cell.label).toBe('Time 1 hour 9 minutes 40 seconds, pace 5:48 per kilometre');
    expect(buildRunTime(run({ date: '2026-08-21', distance: 20, moving_time: 7200 })).label).toBe('Time 2 hours, pace 6:00 per kilometre');
    expect(buildRunTime(run({ date: '2026-08-21', distance: 12, moving_time: 3605 })).label).toBe('Time 1 hour 5 seconds, pace 5:00 per kilometre');
  });

  it.each([
    ['saknas', undefined],
    ['null', null],
    ['0', 0],
    ['NaN', Number.NaN],
    ['negativ', -30],
  ])('moving_time %s ger tankstreck och "no time recorded", aldrig NaN eller 0:00', (_name, movingTime) => {
    expect(buildRunTime(run({ date: '2026-08-21', distance: 10, moving_time: movingTime }))).toEqual({
      timed: false, time: '—', pace: '—', label: 'no time recorded',
    });
  });

  it('distans 0 eller ett tempo som avrundas till 0 ger tankstreck', () => {
    expect(buildRunTime(run({ date: '2026-08-21', distance: 0, moving_time: 3000 })).timed).toBe(false);
    expect(buildRunTime(run({ date: '2026-08-21', distance: 10, moving_time: 4 })).timed).toBe(false);
  });

  it('raden bär cellen', () => {
    expect(buildRunRow(run({ date: '2026-08-21', distance: 10, moving_time: 3130 })).timing.time).toBe('52:10');
  });
});

describe('summan över de visade rundorna', () => {
  const timed = (distance: number, movingTime: number) => run({ date: '2026-08-21', id: `${distance}-${movingTime}`, distance, moving_time: movingTime });

  it('total tid och tempo = summan över rundor med tid (tempot ur de ej avrundade summorna)', () => {
    const summary = buildRunTimeSummary([timed(10, 3130), timed(7.5, 2407), timed(10, 3210)]);
    expect(summary).toMatchObject({ timed: true, time: '2:25:47', pace: '5:18 /km', basis: null });
  });

  it('en runda utan tid räknas inte, varken i tiden eller i distansen, och "based on N of M" visas', () => {
    const withGap = buildRunTimeSummary([timed(10, 3130), run({ date: '2026-07-31', distance: 6, moving_time: null })]);
    expect(withGap).toMatchObject({ time: '52:10', pace: '5:13 /km', basis: 'based on 1 of 2 runs' });
  });

  it('över en timme: h:mm:ss synligt, ord för skärmläsare', () => {
    const summary = buildRunTimeSummary([timed(10, 3130), timed(7.5, 2407), timed(10, 3210)]);
    expect(summary.label).toBe('Total time 2 hours 25 minutes 47 seconds, pace 5:18 per kilometre');
  });

  it('under en timme läses summan som i raderna', () => {
    expect(buildRunTimeSummary([timed(10, 3130)]).label).toBe('Total time 52:10, pace 5:13 per kilometre');
  });

  it.each([
    ['en tom lista', []],
    ['bara rundor utan tid', [run({ date: '2026-08-21', moving_time: undefined }), run({ date: '2026-08-20', moving_time: null }), run({ date: '2026-08-19', moving_time: 0 }), run({ date: '2026-08-18', moving_time: Number.NaN })]],
    ['ett tempo som avrundas till 0', [timed(10, 4)]],
  ])('%s ger tankstreck för båda värdena', (_name, runs) => {
    const summary = buildRunTimeSummary(runs);
    expect(summary).toMatchObject({ timed: false, time: '—', pace: '—', label: 'Total time: no time recorded' });
    expect(`${summary.time} ${summary.pace} ${summary.label}`).not.toMatch(/NaN|Infinity|0:00|-\d/);
  });
});

describe('Strava-rundor kan inte raderas', () => {
  it('source "strava" är en Strava-runda; "manual", null och saknad source (äldre rader) räknas som manuella', () => {
    expect(isStravaRun(run({ date: '2026-10-02', source: 'strava' }))).toBe(true);
    expect(isStravaRun(run({ date: '2026-10-02', source: 'manual' }))).toBe(false);
    expect(isStravaRun(run({ date: '2026-10-02', source: null }))).toBe(false);
    expect(isStravaRun(run({ date: '2026-10-02' }))).toBe(false);
  });

  it('förklaringen säger vad som händer och vad man gör i stället', () => {
    expect(STRAVA_DELETE_HINT).toBe('Strava runs come back from Strava — delete it in Strava instead');
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
    expect(validatePicture({ size: PROFILE_PICTURE_MAX_BYTES, type: 'image/jpeg' })).toBeNull();
    expect(validatePicture({ size: PROFILE_PICTURE_MAX_BYTES + 1, type: 'image/png' })).toBe('The image must be smaller than 5 MB');
    expect(PROFILE_PICTURE_MAX_BYTES / (1024 * 1024)).toBe(5); // the text above names the limit in MB
    expect(validatePicture({ size: 10, type: 'application/pdf' })).toBe('Only JPEG, PNG, WebP or GIF images are allowed');
    expect(validatePicture(undefined)).toBe('Choose an image to upload');
  });
});

describe('my titles', () => {
  const title = (id: string, over: Partial<UserTitleEntry> = {}): UserTitleEntry => ({
    title_id: id, title_name: `Title ${id}`, title_description: '', position: 1, value: 10, earned_at: '', is_current_holder: true, status: 'holder', ...over,
  });
  const board: TitleLeaderboardEntry[] = [];
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
