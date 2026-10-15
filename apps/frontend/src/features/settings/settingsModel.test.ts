import { describe, expect, it } from 'vitest';
import { stravaPollIntervalLabel } from '@runquest/shared';
import { EMPTY_PASSWORD_FORM, STRAVA_IMPORT_RULES, buildStravaCard, buildSyncRow, countStravaRuns, validatePasswordChange } from './settingsModel';

const NOW = new Date('2026-10-05T12:00:00Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000).toISOString();

const SYNC = { last_sync_attempt: minutes(-32), last_sync_status: 'success', next_sync_estimated: minutes(28), new_runs: 2 };
const IMPORTED = minutes(-3 * 60);

describe('buildStravaCard', () => {
  it('kopplad: grönt chip, två celler (Connected och Last import, ingen nästa synk) och reglerna om vad som importeras', () => {
    const card = buildStravaCard({ connected: true, expired: false, connection_date: '2026-08-25T09:31:00Z', last_import_at: IMPORTED }, NOW);
    expect(card.state).toBe('connected');
    expect(card.tone).toBe('up');
    expect(card.chip).toBe('Connected');
    expect(card.meta.map((cell) => [cell.label, cell.value])).toEqual([
      ['Connected', '25 August 2026'],
      ['Last import', '3 h ago'],
    ]);
    expect(card.rules).toHaveLength(3);
  });

  it('reglerna säger att rundor kommer när de sparas på Strava, med en reservkontroll', () => {
    expect(STRAVA_IMPORT_RULES[0]).toBe(`Your Strava runs are imported as you save them, with a backup check every ${stravaPollIntervalLabel()}.`);
  });

  it('the Strava card has no Next sync row and no Last sync row', () => {
    const card = buildStravaCard({ connected: true, expired: false, last_import_at: IMPORTED }, NOW);
    expect(card.meta.map((cell) => cell.label)).toEqual(['Connected', 'Last import']);
    expect(JSON.stringify(card)).not.toMatch(/next sync|last sync|overdue/i);
  });

  it('last import with a value shows how long ago, in the same relative format as before', () => {
    const value = (last_import_at: string) => buildStravaCard({ connected: true, expired: false, last_import_at }, NOW).meta.find((cell) => cell.key === 'last');
    expect(value(minutes(-0.2))).toMatchObject({ value: 'just now', tone: 'up' });
    expect(value(minutes(-32))).toMatchObject({ value: '32 min ago', tone: 'up' });
    expect(value(minutes(-3 * 60))).toMatchObject({ value: '3 h ago', tone: 'up' });
    expect(value(minutes(-2 * 24 * 60))).toMatchObject({ value: '2 d ago', tone: 'up' });
  });

  it('no run imported yet (null, or missing from an older server): "No runs imported yet", muted', () => {
    for (const status of [{ connected: true, expired: false, last_import_at: null }, { connected: true, expired: false }]) {
      const last = buildStravaCard(status, NOW).meta.find((cell) => cell.key === 'last');
      expect(last).toMatchObject({ label: 'Last import', value: 'No runs imported yet', tone: 'muted' });
    }
  });

  it('an unreadable timestamp is treated as no import, never as a made-up time', () => {
    expect(buildStravaCard({ connected: true, expired: false, last_import_at: 'not a date' }, NOW).meta.find((cell) => cell.key === 'last')?.value).toBe('No runs imported yet');
  });

  it('utgången koppling: rött chip, uppmaning att koppla om, inga celler', () => {
    const card = buildStravaCard({ connected: true, expired: true }, NOW);
    expect(card).toMatchObject({ state: 'expired', tone: 'down', chip: 'Expired', meta: [], rules: [] });
    expect(card.lead).toMatch(/Reconnect/);
  });

  it('inte kopplad: neutralt chip och inga celler', () => {
    const card = buildStravaCard({ connected: false, expired: false }, NOW);
    expect(card).toMatchObject({ state: 'disconnected', tone: 'muted', chip: 'Not connected', meta: [] });
  });

  it('token som förnyats (eller inte kunde förnyas) i samband med statusläsningen blir en rad i kortet', () => {
    expect(buildStravaCard({ connected: true, expired: false, auto_refreshed: true }, NOW).renewal?.tone).toBe('up');
    const failed = buildStravaCard({ connected: true, expired: true, refresh_failed: true }, NOW).renewal;
    expect(failed?.tone).toBe('down');
    expect(failed?.text).toMatch(/Reconnect/);
    expect(buildStravaCard({ connected: true, expired: false }, NOW).renewal).toBeNull();
  });
});

describe('buildStravaCard when sync is paused', () => {
  // paused_at kommer som +00:00 (PostgREST), inte Z: den tolkas med new Date, aldrig som sträng.
  const PAUSED = { connected: true, expired: false, connection_date: '2026-08-25T09:31:00Z', sync_paused: true, paused_at: '2026-10-12T08:30:00+00:00' };

  it('is a neutral Paused card: not the green live state and not the red alarm state', () => {
    const card = buildStravaCard(PAUSED, NOW);
    expect(card).toMatchObject({ state: 'paused', tone: 'paused', chip: 'Paused' });
    expect(card.lead).toMatch(/paused/i);
  });

  it('keeps the last import, shows no next sync and drops the import rules for one sentence about removals', () => {
    const card = buildStravaCard({ ...PAUSED, last_import_at: IMPORTED }, NOW);
    expect(card.meta.map((cell) => [cell.label, cell.value])).toEqual([
      ['Connected', '25 August 2026'],
      ['Last import', '3 h ago'],
    ]);
    expect(card.rules).toEqual([]);
    expect(card.note).toBe('Paused since 12 October 2026. Runs you delete or make private on Strava are still removed here.');
  });

  it('leaves out the date when paused_at is missing or unreadable, and keeps the removal sentence', () => {
    for (const paused_at of [undefined, null, 'not a date']) {
      expect(buildStravaCard({ ...PAUSED, paused_at }, NOW).note).toBe('Runs you delete or make private on Strava are still removed here.');
    }
  });

  it('an expired connection is expired even if the pause flag is still set', () => {
    expect(buildStravaCard({ ...PAUSED, expired: true }, NOW)).toMatchObject({ state: 'expired', note: null });
  });

  it('a running connection has no note', () => {
    expect(buildStravaCard({ connected: true, expired: false, sync_paused: false, paused_at: null }, NOW)).toMatchObject({ state: 'connected', note: null });
  });
});

describe('countStravaRuns', () => {
  it('counts only runs that came from strava', () => {
    expect(countStravaRuns([{ source: 'strava' }, { source: 'manual' }, { source: null }, { source: 'strava' }, {}])).toBe(2);
  });

  it('is null while the runs are not known, never 0', () => {
    expect(countStravaRuns(undefined)).toBeNull();
  });

  it('is 0 once the runs are known and none came from strava', () => {
    expect(countStravaRuns([{ source: 'manual' }])).toBe(0);
    expect(countStravaRuns([])).toBe(0);
  });
});

describe('buildSyncRow', () => {
  it('ingen synk än: ingen rad', () => {
    expect(buildSyncRow(undefined)).toBeNull();
    expect(buildSyncRow({ ...SYNC, last_sync_attempt: null })).toBeNull();
  });

  it('nya rundor, inga nya rundor och misslyckad synk', () => {
    expect(buildSyncRow(SYNC)).toMatchObject({ result: '2 new runs', tone: 'up' });
    expect(buildSyncRow({ ...SYNC, new_runs: 1 })?.result).toBe('1 new run');
    expect(buildSyncRow({ ...SYNC, new_runs: 0 })).toMatchObject({ result: 'no new activities', tone: 'muted' });
    expect(buildSyncRow({ ...SYNC, last_sync_status: 'error' })).toMatchObject({ result: 'sync failed', tone: 'down' });
  });

  it('klockslaget är HH:MM', () => {
    expect(buildSyncRow(SYNC)?.time).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe('validatePasswordChange', () => {
  const ok = { current: 'old-secret', next: 'new-secret', confirm: 'new-secret' };

  it('giltigt formulär ger inga fel', () => {
    expect(validatePasswordChange(ok)).toEqual({});
  });

  it('tomt formulär: ett fel per fält', () => {
    expect(Object.keys(validatePasswordChange(EMPTY_PASSWORD_FORM)).sort()).toEqual(['confirm', 'current', 'next']);
  });

  it('för kort nytt lösenord (minst 6 tecken)', () => {
    expect(validatePasswordChange({ ...ok, next: 'abc', confirm: 'abc' }).next).toBe('Password must be at least 6 characters');
  });

  it('olika lösenord pekar på bekräftelsefältet', () => {
    expect(validatePasswordChange({ ...ok, confirm: 'something-else' })).toEqual({ confirm: 'The new passwords do not match' });
  });

  it('ett kort lösenord utan bekräftelse klagar på båda, inte bara på det ena', () => {
    const errors = validatePasswordChange({ current: 'x', next: 'abc', confirm: '' });
    expect(errors.next).toBeDefined();
    expect(errors.confirm).toBe('Repeat the new password');
  });
});
