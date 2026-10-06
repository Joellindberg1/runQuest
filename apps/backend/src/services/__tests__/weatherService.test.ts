/**
 * Vinden i run_weather heter *_ms och ska vara m/s. Open-Meteo levererar km/h om inte `wind_speed_unit=ms`
 * skickas — både forecast- och archive-anropet måste ha parametern.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const upsert = vi.fn(async () => ({ error: null }));

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(() => ({ from: () => ({ upsert }) })),
}));

import { WeatherService } from '../weatherService.js';

const NOW = new Date('2026-10-06T12:00:00.000Z');

function hourly(startIso: string) {
  const hour = startIso.slice(0, 13);
  return {
    hourly: {
      time: [`${hour}:00`],
      temperature_2m: [9.5], apparent_temperature: [7], relative_humidity_2m: [80], precipitation: [0],
      snowfall: [0], snow_depth: [0], wind_speed_10m: [5.2], wind_gusts_10m: [11.4], wind_direction_10m: [240],
      weather_code: [3], uv_index: [1], visibility: [20000],
    },
  };
}

const run = (startTime: string) => ({
  id: 'run-1', start_lat: 59.33, start_lng: 18.07, start_time: startTime, moving_time: 1800, is_treadmill: false,
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  upsert.mockClear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('WeatherService — vind i m/s', () => {
  it('färsk runda: forecast-anropet ber om m/s, och värdet sparas som det kom', async () => {
    const start = '2026-10-06T07:00:00.000Z';
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => hourly(start) });
    await WeatherService.fetchAndSaveWeatherForRun(run(start));
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('api.open-meteo.com/v1/forecast');
    expect(url).toContain('&wind_speed_unit=ms');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ run_id: 'run-1', wind_speed_ms: 5.2, wind_gusts_ms: 11.4 }),
      { onConflict: 'run_id' },
    );
  });

  it('äldre runda: archive-anropet ber också om m/s', async () => {
    const start = '2026-09-01T07:00:00.000Z';
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => hourly(start) });
    await WeatherService.fetchAndSaveWeatherForRun(run(start));
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('archive-api.open-meteo.com/v1/archive');
    expect(url).toContain('&wind_speed_unit=ms');
  });

  it('fetched_at sätts vid varje skrivning (omräkningen av gamla km/h-rader skiljer på den)', async () => {
    const start = '2026-10-06T07:00:00.000Z';
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => hourly(start) });
    await WeatherService.fetchAndSaveWeatherForRun(run(start));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ fetched_at: NOW.toISOString() }), { onConflict: 'run_id' });
  });
});
