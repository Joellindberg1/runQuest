/**
 * RUN-105 T5: när wallClockToInstantMs ger NaN (start_time utan Z/+00:00 eller ogiltig) faller anropet till
 * archive-grenen. Det ska loggas som en varning med run-id — men beteendet i övrigt är oförändrat.
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
import { logger } from '../../utils/logger.js';

const run = (startTime: string) => ({
  id: 'run-nan', start_lat: 59.33, start_lng: 18.07, start_time: startTime, moving_time: 1800, is_treadmill: false,
});

function archiveResponse(hour = '2026-07-04T06:00') {
  const col = (v: number) => [v];
  return {
    hourly: {
      time: [hour], temperature_2m: [6],
      apparent_temperature: col(0), relative_humidity_2m: col(0), precipitation: col(0), snowfall: col(0),
      snow_depth: col(0), wind_speed_10m: col(0), wind_gusts_10m: col(0), wind_direction_10m: col(0),
      weather_code: col(0), uv_index: col(0), visibility: col(0),
    },
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-04T10:00:00Z'));
  upsert.mockClear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  vi.spyOn(logger, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('WeatherService — start_time som wallClockToInstantMs inte kan tolka', () => {
  it('riktig offset (+02:00) är ett giltigt Date men NaN som väggklocka: varnar en gång med run-id och går som förut till archive', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => archiveResponse('2026-07-04T04:00') });

    const saved = await WeatherService.fetchAndSaveWeatherForRun(run('2026-07-04T06:00:00+02:00'));

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('run-nan');
    expect(message).not.toMatch(/59\.33|18\.07/); // ingen koordinat i loggen
    expect(new URL(String(fetchMock.mock.calls[0][0])).hostname).toBe('archive-api.open-meteo.com');
    expect(saved).toBe(true);
  });

  it('skräp-start_time: varnar med run-id och returnerar false utan att anropa Open-Meteo, som förut', async () => {
    const saved = await WeatherService.fetchAndSaveWeatherForRun(run('inte-ett-datum'));

    expect(saved).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(warn.mock.calls.some(([m]) => String(m).includes('run-nan') && String(m).includes('start_time'))).toBe(true);
  });

  it('giltig väggklocka (Z) ger ingen varning', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => archiveResponse() });

    await WeatherService.fetchAndSaveWeatherForRun(run('2026-07-04T06:00:00Z'));

    expect(warn).not.toHaveBeenCalled();
  });
});
