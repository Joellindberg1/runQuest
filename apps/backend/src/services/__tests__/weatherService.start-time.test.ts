/**
 * runs.start_time är lokal väggklocka med falskt Z (se packages/shared/src/calendar.ts). Rundans ålder
 * (past_hours) måste räknas från det verkliga ögonblicket, medan timmatchningen mot Open-Meteo (som svarar
 * i Stockholmstid) fortsätter ske på väggklockan.
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

const run = (startTime: string) => ({
  id: 'run-1', start_lat: 59.33, start_lng: 18.07, start_time: startTime, moving_time: 1800, is_treadmill: false,
});

function response(times: string[], temps: number[]) {
  const n = times.length;
  const col = (v: number) => Array(n).fill(v);
  return {
    hourly: {
      time: times, temperature_2m: temps,
      apparent_temperature: col(0), relative_humidity_2m: col(0), precipitation: col(0), snowfall: col(0),
      snow_depth: col(0), wind_speed_10m: col(0), wind_gusts_10m: col(0), wind_direction_10m: col(0),
      weather_code: col(0), uv_index: col(0), visibility: col(0),
    },
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  upsert.mockClear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function pastHoursFor(start: string, now: string): Promise<number> {
  vi.setSystemTime(new Date(now));
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => response([start.slice(0, 16)], [1]) });
  await WeatherService.fetchAndSaveWeatherForRun(run(start));
  const url = new URL(String(fetchMock.mock.calls[0][0]));
  expect(url.hostname).toBe('api.open-meteo.com');
  return Number(url.searchParams.get('past_hours'));
}

describe('WeatherService — rundans ålder räknas från väggklockan som ögonblick', () => {
  it('sommar: start 06:00 lokalt = 04:00 UTC, nu 10:00 UTC -> past_hours = 6 + 2 = 8', async () => {
    expect(await pastHoursFor('2026-07-04T06:00:00Z', '2026-07-04T10:00:00Z')).toBe(8);
  });

  it('vinter: start 06:00 lokalt = 05:00 UTC, nu 10:00 UTC -> past_hours = 5 + 2 = 7', async () => {
    expect(await pastHoursFor('2026-01-10T06:00:00Z', '2026-01-10T10:00:00Z')).toBe(7);
  });

  it('+00:00-formen (Supabase) ger samma past_hours', async () => {
    expect(await pastHoursFor('2026-07-04T06:00:00+00:00', '2026-07-04T10:00:00Z')).toBe(8);
  });
});

describe('WeatherService — timmatchningen mot Open-Meteo sker på väggklockan (Stockholmstid)', () => {
  it('svaret med time ["2026-07-04T06:00"] ger rätt index, inte timmen före (04:00 UTC)', async () => {
    vi.setSystemTime(new Date('2026-07-04T10:00:00Z'));
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => response(['2026-07-04T04:00', '2026-07-04T05:00', '2026-07-04T06:00', '2026-07-04T07:00'], [4, 5, 6, 7]),
    });
    await WeatherService.fetchAndSaveWeatherForRun(run('2026-07-04T06:00:00Z'));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ run_id: 'run-1', temperature_c: 6 }), { onConflict: 'run_id' });
  });

  it('archive-anropet (äldre runda) använder lokala datumet', async () => {
    vi.setSystemTime(new Date('2026-07-20T10:00:00Z'));
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => response(['2026-07-04T00:00'], [1]) });
    await WeatherService.fetchAndSaveWeatherForRun(run('2026-07-04T00:30:00Z'));
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.hostname).toBe('archive-api.open-meteo.com');
    expect(url.searchParams.get('start_date')).toBe('2026-07-04');
  });
});
