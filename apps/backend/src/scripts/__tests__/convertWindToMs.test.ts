import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));

import { formatReport, kmhToMs, parseArgs, runConversion } from '../convertWindToMs.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

const CUTOFF = '2026-10-06T10:15:00Z';
const LATER = '2026-10-06T12:00:00.000Z';

function weather(): Record<string, Row[]> {
  return {
    run_weather: [
      { run_id: 'a', wind_speed_ms: '18.0', wind_gusts_ms: '36.0', fetched_at: '2026-09-01T08:00:00.000Z' },
      { run_id: 'b', wind_speed_ms: null, wind_gusts_ms: '54.0', fetched_at: '2026-10-06T10:14:59.000Z' },
      { run_id: 'c', wind_speed_ms: '4.1', wind_gusts_ms: '9.8', fetched_at: '2026-10-06T10:15:00.000Z' }, // redan m/s
    ],
  };
}

const opts = (over: Partial<ReturnType<typeof parseArgs>> = {}) => ({ before: CUTOFF, apply: false, backup: null, ...over });

describe('kmhToMs', () => {
  it('delar med 3,6 och avrundar till en decimal; null och skräp blir null', () => {
    expect(kmhToMs(36)).toBe(10);
    expect(kmhToMs('54.0')).toBe(15);
    expect(kmhToMs(15)).toBe(4.2);
    expect(kmhToMs(null)).toBeNull();
    expect(kmhToMs('x')).toBeNull();
  });
});

describe('parseArgs', () => {
  it('kräver --before som datum MED klockslag (gränsen är deploytiden, inte en dag)', () => {
    expect(() => parseArgs([])).toThrow(/--before/);
    expect(() => parseArgs(['--before=2026-10-06'])).toThrow(/--before/);
    expect(parseArgs([`--before=${CUTOFF}`])).toEqual({ before: CUTOFF, apply: false, backup: null });
  });

  it('--apply kräver --backup, och okända argument stoppas', () => {
    expect(() => parseArgs([`--before=${CUTOFF}`, '--apply'])).toThrow(/--backup/);
    expect(parseArgs([`--before=${CUTOFF}`, '--apply', '--backup=b.json']).apply).toBe(true);
    expect(() => parseArgs([`--before=${CUTOFF}`, '--force'])).toThrow(/Unknown argument/);
  });
});

describe('runConversion', () => {
  it('dry-run: hittar bara rader före gränsen och rör ingenting', async () => {
    const t = weather();
    const writeBackup = vi.fn();
    const report = await runConversion(createFakeDb(t).client as any, opts(), writeBackup);
    expect(report.rows.map((r) => r.run_id)).toEqual(['a', 'b']);
    expect(report.converted).toEqual([
      { run_id: 'a', wind_speed_ms: 5, wind_gusts_ms: 10 },
      { run_id: 'b', wind_speed_ms: null, wind_gusts_ms: 15 },
    ]);
    expect(writeBackup).not.toHaveBeenCalled();
    expect(t.run_weather).toEqual(weather().run_weather);
    expect(formatReport(report)).toMatch(/DRY-RUN[\s\S]*2 row\(s\) would be converted/);
  });

  it('apply: säkerhetskopian skrivs FÖRE raderna, rader efter gränsen orörda, omräknade flyttas över gränsen', async () => {
    const t = weather();
    const order: string[] = [];
    const db = createFakeDb(t);
    const writeBackup = vi.fn((_path: string, json: string) => {
      order.push('backup');
      expect(JSON.parse(json).rows.map((r: Row) => [r.run_id, r.wind_gusts_ms])).toEqual([['a', '36.0'], ['b', '54.0']]);
      expect(t.run_weather[0].wind_gusts_ms).toBe('36.0');
    });
    await runConversion(db.client as any, opts({ apply: true, backup: 'b.json' }), writeBackup, () => new Date(LATER));
    expect(order).toEqual(['backup']);
    expect(writeBackup).toHaveBeenCalledWith('b.json', expect.any(String));
    const byId = Object.fromEntries(t.run_weather.map((r) => [r.run_id, r]));
    expect(byId.a).toMatchObject({ wind_speed_ms: 5, wind_gusts_ms: 10, fetched_at: LATER });
    expect(byId.b).toMatchObject({ wind_speed_ms: null, wind_gusts_ms: 15, fetched_at: LATER });
    expect(byId.c).toEqual(weather().run_weather[2]);
  });

  it('en andra körning med samma gräns hittar inget — ingen rad delas två gånger', async () => {
    const t = weather();
    const db = createFakeDb(t);
    await runConversion(db.client as any, opts({ apply: true, backup: 'b.json' }), vi.fn(), () => new Date(LATER));
    const writeBackup = vi.fn();
    const again = await runConversion(db.client as any, opts({ apply: true, backup: 'b2.json' }), writeBackup, () => new Date(LATER));
    expect(again.rows).toHaveLength(0);
    expect(writeBackup).not.toHaveBeenCalled();
    expect(t.run_weather.find((r) => r.run_id === 'a')).toMatchObject({ wind_gusts_ms: 10 });
  });

  it('läser i sidor om 1000 och klarar en exakt sidmultipel', async () => {
    const rows: Row[] = Array.from({ length: 1000 }, (_, i) => ({
      run_id: `r${String(i).padStart(4, '0')}`, wind_speed_ms: '3.6', wind_gusts_ms: '7.2', fetched_at: '2026-09-01T08:00:00.000Z',
    }));
    const report = await runConversion(createFakeDb({ run_weather: rows }).client as any, opts());
    expect(report.rows).toHaveLength(1000);
    expect(report.converted[999]).toMatchObject({ wind_speed_ms: 1, wind_gusts_ms: 2 });
  });
});
