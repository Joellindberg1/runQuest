/**
 * RUN-98 T2 — toRunData ersätter de två handskrivna rad → RunData-mappningarna i enhancedTitleService
 * och plattar ut run_weather (PostgREST-embed: objekt vid en-till-en, array annars).
 */
import { describe, it, expect } from 'vitest';
import { toRunData } from '../_utils.js';

const base = { date: '2026-03-01', distance_km: 10 };

describe('toRunData', () => {
  it('mappar väderfält ur run_weather-objektet', () => {
    const run = toRunData({
      ...base,
      run_weather: { temperature_c: -7.5, wind_speed_ms: 3.2, wind_gusts_ms: 9.8 },
    });
    expect(run.temperature_c).toBe(-7.5);
    expect(run.wind_speed_ms).toBe(3.2);
    expect(run.wind_gusts_ms).toBe(9.8);
  });

  it('run_weather null → väderfält null', () => {
    const run = toRunData({ ...base, run_weather: null });
    expect(run.temperature_c).toBeNull();
    expect(run.wind_speed_ms).toBeNull();
    expect(run.wind_gusts_ms).toBeNull();
  });

  it('run_weather saknas helt (undefined) → väderfält null', () => {
    const run = toRunData(base);
    expect([run.temperature_c, run.wind_speed_ms, run.wind_gusts_ms]).toEqual([null, null, null]);
  });

  it('run_weather som array med ett element mappas', () => {
    const run = toRunData({ ...base, run_weather: [{ temperature_c: 1.5, wind_speed_ms: 0, wind_gusts_ms: 4 }] });
    expect(run.temperature_c).toBe(1.5);
    expect(run.wind_speed_ms).toBe(0); // 0 m/s är en riktig mätning, inte "saknas"
    expect(run.wind_gusts_ms).toBe(4);
  });

  it('run_weather som tom array → väderfält null', () => {
    const run = toRunData({ ...base, run_weather: [] });
    expect([run.temperature_c, run.wind_speed_ms, run.wind_gusts_ms]).toEqual([null, null, null]);
  });

  it("numeric-sträng '4.5' → 4.5 (PostgREST kan ge numeric som sträng)", () => {
    const run = toRunData({
      ...base,
      run_weather: { temperature_c: '4.5', wind_speed_ms: '-0.0', wind_gusts_ms: '12.25' },
    });
    expect(run.temperature_c).toBe(4.5);
    expect(run.wind_gusts_ms).toBe(12.25);
    expect(typeof run.wind_speed_ms).toBe('number');
  });

  it('enskilda null-fält i run_weather förblir null (inte 0)', () => {
    const run = toRunData({ ...base, run_weather: { temperature_c: null, wind_speed_ms: 5, wind_gusts_ms: null } });
    expect(run.temperature_c).toBeNull();
    expect(run.wind_speed_ms).toBe(5);
    expect(run.wind_gusts_ms).toBeNull();
  });

  it('icke-numeriskt väderfält ("n/a") → null, inte NaN', () => {
    const run = toRunData({ ...base, run_weather: { temperature_c: 'n/a', wind_speed_ms: NaN, wind_gusts_ms: '' } });
    expect([run.temperature_c, run.wind_speed_ms, run.wind_gusts_ms]).toEqual([null, null, null]);
  });

  it('befintliga fält: distance som sträng parsas, saknad/ogiltig distance blir 0, övriga null-defaultas', () => {
    expect(toRunData({ date: 'd', distance_km: '5.25' }).distance_km).toBe(5.25);
    expect(toRunData({ date: 'd', distance_km: undefined }).distance_km).toBe(0);
    expect(toRunData({ date: 'd', distance_km: 'abc' }).distance_km).toBe(0);
    expect(toRunData({ date: 'd', distance_km: 3 })).toMatchObject({
      date: 'd',
      distance_km: 3,
      start_time: null,
      total_elevation_gain: null,
      pace_std_dev: null,
      moving_time: null,
    });
  });

  it('befintliga fält skickas igenom oförändrade', () => {
    const run = toRunData({
      ...base,
      start_time: '2026-03-01T06:00:00Z',
      total_elevation_gain: 12.5,
      pace_std_dev: 20,
      moving_time: 3000,
    });
    expect(run).toMatchObject({
      start_time: '2026-03-01T06:00:00Z',
      total_elevation_gain: 12.5,
      pace_std_dev: 20,
      moving_time: 3000,
    });
  });
});
