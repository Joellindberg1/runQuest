import { describe, expect, it } from 'vitest';
import { buildHistoryRow, buildHistoryRows } from './historyModel';
import { ME, historyItem } from './log.fixture';

describe('buildHistoryRow', () => {
  it('kort med namn, initialer, datum, km och XP', () => {
    const row = buildHistoryRow(historyItem(), ME);
    expect(row).toMatchObject({
      id: 'r1', userId: 'u-karl', name: 'Karl Persson', initials: 'KP', date: '2026-10-03', km: '8.4', xp: '51', isMe: false,
    });
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

describe('buildHistoryRows', () => {
  it('behåller ordningen (nyast först kommer från servern)', () => {
    const rows = buildHistoryRows([historyItem({ id: 'a' }), historyItem({ id: 'b' })], ME);
    expect(rows.map((row) => row.id)).toEqual(['a', 'b']);
  });
});
