import { describe, expect, it } from 'vitest';
import { EMPTY_PASSWORD_FORM, buildStravaCard, buildSyncRow, validatePasswordChange } from './settingsModel';

const NOW = new Date('2026-10-05T12:00:00Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000).toISOString();

const SYNC = { last_sync_attempt: minutes(-32), last_sync_status: 'success', next_sync_estimated: minutes(28), new_runs: 2 };

describe('buildStravaCard', () => {
  it('kopplad: grönt chip, tre celler och reglerna om vad som importeras', () => {
    const card = buildStravaCard({ connected: true, expired: false, connection_date: '2026-08-25T09:31:00Z' }, SYNC, NOW);
    expect(card.state).toBe('connected');
    expect(card.tone).toBe('up');
    expect(card.chip).toBe('Connected');
    expect(card.meta.map((cell) => [cell.label, cell.value])).toEqual([
      ['Connected', '25 August 2026'],
      ['Last sync', '32 min ago'],
      ['Next sync', 'in 28 min'],
    ]);
    expect(card.rules).toHaveLength(3);
  });

  it('ingen synk har körts: sägs rakt ut, aldrig en tom cell', () => {
    const card = buildStravaCard({ connected: true, expired: false }, { last_sync_attempt: null, last_sync_status: 'none', next_sync_estimated: null }, NOW);
    expect(card.meta.map((cell) => cell.value)).toEqual(['Unknown', 'No server sync yet', 'Unknown']);
  });

  it('nästa synk i det förflutna heter Overdue', () => {
    const card = buildStravaCard({ connected: true, expired: false }, { ...SYNC, next_sync_estimated: minutes(-5) }, NOW);
    expect(card.meta.find((cell) => cell.key === 'next')?.value).toBe('Overdue');
  });

  it('synkinfo saknas (hämtningen föll): kortet visas ändå, med ärliga celler', () => {
    const card = buildStravaCard({ connected: true, expired: false }, undefined, NOW);
    expect(card.state).toBe('connected');
    expect(card.meta.map((cell) => cell.value)).toEqual(['Unknown', 'No server sync yet', 'Unknown']);
  });

  it('utgången koppling: rött chip, uppmaning att koppla om, inga celler', () => {
    const card = buildStravaCard({ connected: true, expired: true }, SYNC, NOW);
    expect(card).toMatchObject({ state: 'expired', tone: 'down', chip: 'Expired', meta: [], rules: [] });
    expect(card.lead).toMatch(/Reconnect/);
  });

  it('inte kopplad: neutralt chip och inga celler', () => {
    const card = buildStravaCard({ connected: false, expired: false }, SYNC, NOW);
    expect(card).toMatchObject({ state: 'disconnected', tone: 'muted', chip: 'Not connected', meta: [] });
  });

  it('token som förnyats (eller inte kunde förnyas) i samband med statusläsningen blir en rad i kortet', () => {
    expect(buildStravaCard({ connected: true, expired: false, auto_refreshed: true }, SYNC, NOW).renewal?.tone).toBe('up');
    const failed = buildStravaCard({ connected: true, expired: true, refresh_failed: true }, SYNC, NOW).renewal;
    expect(failed?.tone).toBe('down');
    expect(failed?.text).toMatch(/Reconnect/);
    expect(buildStravaCard({ connected: true, expired: false }, SYNC, NOW).renewal).toBeNull();
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
