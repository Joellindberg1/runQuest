import { describe, expect, it } from 'vitest';
import type { GroupRunHistoryItem } from '@runquest/shared';
import { buildRunTime } from '@/features/profile/profileModel';
import { buildHistoryRow, buildHistoryRows } from './historyModel';
import { ME, historyItem } from './log.fixture';

describe('buildHistoryRow', () => {
  it('kort med namn, initialer, datum, km och XP', () => {
    const row = buildHistoryRow(historyItem(), ME);
    expect(row).toMatchObject({
      id: 'r1', userId: 'u-karl', name: 'Karl Persson', initials: 'KP', date: '2026-10-03', km: '8.4', xp: '51', isMe: false,
    });
  });

  it('initialer: första och sista namnets, så Anna Maria Lindqvist är AL', () => {
    expect(buildHistoryRow(historyItem({ user_name: 'Anna Maria Lindqvist' }), ME).initials).toBe('AL');
  });

  it('de fem cellerna: streakdag, multiplikator, base, km och bonus', () => {
    const { cells } = buildHistoryRow(historyItem(), ME);
    expect(cells.map((cell) => [cell.label, cell.value, cell.tone])).toEqual([
      ['streak day', '8', 'default'],
      ['multiplier', '1.6×', 'gold'],
      ['base xp', '15', 'default'],
      ['km xp', '16', 'default'],
      ['bonus', '+5', 'up'],
    ]);
  });

  it('ingen multiplikator och ingen bonus dämpas', () => {
    const { cells } = buildHistoryRow(historyItem({ multiplier: 1, distance_bonus: 0 }), ME);
    expect(cells.find((cell) => cell.key === 'multiplier')).toMatchObject({ value: '1.0×', tone: 'muted' });
    expect(cells.find((cell) => cell.key === 'bonus')).toMatchObject({ value: '0', tone: 'muted' });
  });

  it('underlag: utomhus, löpband, och okänt utan chip', () => {
    expect(buildHistoryRow(historyItem({ is_treadmill: false }), ME).surface).toBe('outdoor');
    expect(buildHistoryRow(historyItem({ is_treadmill: true }), ME).surface).toBe('treadmill');
    expect(buildHistoryRow(historyItem({ is_treadmill: null }), ME).surface).toBeNull();
  });

  it('källa: Strava markeras, övrigt skrivs med stor bokstav, saknad källa är Manual', () => {
    expect(buildHistoryRow(historyItem({ source: 'strava' }), ME).source).toEqual({ label: 'Strava', strava: true });
    expect(buildHistoryRow(historyItem({ source: 'manual' }), ME).source).toEqual({ label: 'Manual', strava: false });
    expect(buildHistoryRow(historyItem({ source: undefined }), ME).source).toEqual({ label: 'Manual', strava: false });
  });

  it('väder: klart förklaras av ikonen, övrigt skrivs ut, ingen data ger inget väder', () => {
    expect(buildHistoryRow(historyItem({ weather_code: 0, temperature_c: 19.4 }), ME).weather).toEqual({ icon: 'sun', temperature: '19 °C', label: null });
    expect(buildHistoryRow(historyItem({ weather_code: 63, temperature_c: 14 }), ME).weather).toEqual({ icon: null, temperature: '14 °C', label: 'Rain' });
    expect(buildHistoryRow(historyItem({ weather_code: 73, temperature_c: -2 }), ME).weather).toEqual({ icon: 'snow', temperature: '-2 °C', label: 'Snow' });
    expect(buildHistoryRow(historyItem({ weather_code: 2, temperature_c: 17.2 }), ME).weather).toEqual({ icon: null, temperature: '17 °C', label: 'Partly cloudy' });
    expect(buildHistoryRow(historyItem({ weather_code: null, temperature_c: null }), ME).weather).toBeNull();
    expect(buildHistoryRow(historyItem({ weather_code: 999, temperature_c: 10 }), ME).weather).toEqual({ icon: null, temperature: '10 °C', label: null });
  });

  it('min egen runda markeras', () => {
    expect(buildHistoryRow(historyItem({ user_id: ME }), ME).isMe).toBe(true);
    expect(buildHistoryRow(historyItem({ user_id: ME }), undefined).isMe).toBe(false);
  });

  it('profilbild följer med när den finns', () => {
    expect(buildHistoryRow(historyItem({ user_profile_picture: 'https://x/y.png' }), ME).pictureUrl).toBe('https://x/y.png');
    expect(buildHistoryRow(historyItem(), ME).pictureUrl).toBeNull();
  });
});

describe('buildHistoryRow — tid och tempo', () => {
  it('history row time and pace come from the shared functions', () => {
    // 3130 s på 10 km = 313 s/km: tid 52:10, tempo 5:13. Skärmläsartexten byggs av samma värden.
    expect(buildHistoryRow(historyItem({ moving_time: 3130, distance: 10 }), ME)).toMatchObject({
      time: '52:10', pace: '5:13', timePaceLabel: 'Time 52:10, pace 5:13 per kilometre',
    });
    // Tempot avrundas före uppdelningen (359,64 s/km blir 6:00, aldrig 5:60) och timmar får egen siffra.
    expect(buildHistoryRow(historyItem({ moving_time: 3600, distance: 10.01 }), ME)).toMatchObject({ time: '1:00:00', pace: '6:00' });
    expect(buildHistoryRow(historyItem({ moving_time: 4180, distance: 12.1 }), ME)).toMatchObject({ time: '1:09:40', pace: '5:45' });
  });

  it.each([
    ['moving_time saknas (undefined)', { moving_time: undefined }],
    ['moving_time är null', { moving_time: null }],
    ['moving_time är 0', { moving_time: 0 }],
    ['moving_time är NaN', { moving_time: Number.NaN }],
    ['moving_time är negativ', { moving_time: -30 }],
    ['distansen är 0', { moving_time: 1200, distance: 0 }],
    ['distansen är NaN', { moving_time: 1200, distance: Number.NaN }],
    ['tempot avrundas till 0 s/km', { moving_time: 1, distance: 10 }],
  ] as Array<[string, Partial<GroupRunHistoryItem>]>)('ingen användbar tid ger tankstreck-läget, aldrig NaN, 0:00 eller negativa tal: %s', (_name, over) => {
    const row = buildHistoryRow(historyItem(over), ME);
    expect(row.time).toBeNull();
    expect(row.pace).toBeNull();
    expect(row.timePaceLabel).toBe('no time recorded');
  });

  it('kedjan från API-rader till formaterad tid och tempo: med tid, utan tid, distans 0 och tid 0', () => {
    const rows = buildHistoryRows(
      [
        historyItem({ id: 'with', moving_time: 2670, distance: 8 }),
        historyItem({ id: 'without', moving_time: null, distance: 8 }),
        historyItem({ id: 'no-distance', moving_time: 1200, distance: 0 }),
        historyItem({ id: 'no-time', moving_time: 0, distance: 8 }),
      ],
      ME,
    );
    expect(rows.map((row) => [row.id, row.time, row.pace])).toEqual([
      ['with', '44:30', '5:34'],
      ['without', null, null],
      ['no-distance', null, null],
      ['no-time', null, null],
    ]);
  });
});

describe('skärmläsartexten för tid och tempo är densamma i Group history och i profilen', () => {
  // Samma runda genom båda vymodellerna: tid och distans är det enda som avgör texten.
  it.each([
    ['under en timme', { moving_time: 3130, distance: 10 }],
    ['en timme eller mer', { moving_time: 4180, distance: 12.1 }],
    ['exakt en timme', { moving_time: 3600, distance: 12 }],
    ['utan tid', { moving_time: null, distance: 8 }],
  ] as Array<[string, Partial<GroupRunHistoryItem>]>)('%s', (_name, over) => {
    const item = historyItem(over);
    expect(buildHistoryRow(item, ME).timePaceLabel).toBe(buildRunTime(item).label);
  });
});

describe('buildHistoryRows', () => {
  it('behåller ordningen (nyast först kommer från servern)', () => {
    const rows = buildHistoryRows([historyItem({ id: 'a' }), historyItem({ id: 'b' })], ME);
    expect(rows.map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('samma runda på två sidor ger en rad (första förekomsten vinner, ordningen behålls)', () => {
    // Offsetsidor glider när en ny runda läggs till mellan två hämtningar: sista raden på sida ett kommer då igen överst på sida två.
    const pageOne = [historyItem({ id: 'a' }), historyItem({ id: 'b', moving_time: 3130, distance: 10 })];
    const pageTwo = [historyItem({ id: 'b', moving_time: 9999, distance: 10 }), historyItem({ id: 'c' })];
    const rows = buildHistoryRows([...pageOne, ...pageTwo], ME);
    expect(rows.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(rows[1]?.time).toBe('52:10');
  });
});
