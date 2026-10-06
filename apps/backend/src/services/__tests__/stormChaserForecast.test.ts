/**
 * Storm Chaser-prognosen (issue #19): byarna ska jämföras i m/s. Open-Meteo levererar km/h om inte
 * `wind_speed_unit=ms` skickas, och då blir tröskeln 15 km/h (≈ 4 m/s) — en vanlig bris.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));

import { checkStormChaserForecast } from '../eventService.js';

const TOMORROW = '2026-10-07';
const CLEAR = 0;
const RAIN = 61;

/** 24 timmar för imorgon; `hours` sätter värden per timme (Stockholm-tid). */
function forecast(hours: Record<number, { code?: number; gust?: number }>) {
  const time: string[] = [];
  const weather_code: number[] = [];
  const wind_gusts_10m: number[] = [];
  for (let h = 0; h < 24; h++) {
    time.push(`${TOMORROW}T${String(h).padStart(2, '0')}:00`);
    weather_code.push(hours[h]?.code ?? CLEAR);
    wind_gusts_10m.push(hours[h]?.gust ?? 3);
  }
  return { hourly: { time, weather_code, wind_gusts_10m } };
}

const gusty = (from: number, count: number, gust: number) =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [from + i, { gust }]));

let fetchMock: ReturnType<typeof vi.fn>;

function respond(body: unknown) {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => body });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-06T10:00:00.000Z'));
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('checkStormChaserForecast', () => {
  it('ber Open-Meteo om vind i m/s', async () => {
    respond(forecast({}));
    await checkStormChaserForecast();
    expect(String(fetchMock.mock.calls[0][0])).toContain('wind_speed_unit=ms');
  });

  it('4 dagtimmar med byar på 15 m/s kvalificerar', async () => {
    respond(forecast(gusty(10, 4, 15)));
    expect(await checkStormChaserForecast()).toBe(true);
  });

  it('byar strax under 15 m/s, eller bara 3 timmar, kvalificerar inte', async () => {
    respond(forecast(gusty(10, 4, 14.9)));
    expect(await checkStormChaserForecast()).toBe(false);
    respond(forecast(gusty(10, 3, 20)));
    expect(await checkStormChaserForecast()).toBe(false);
  });

  it('byar nattetid (före 06, efter 21) räknas inte', async () => {
    respond(forecast({ ...gusty(0, 4, 20), ...gusty(22, 2, 20) }));
    expect(await checkStormChaserForecast()).toBe(false);
  });

  it('3 dagtimmar regn kvalificerar oavsett vind', async () => {
    respond(forecast({ 8: { code: RAIN }, 12: { code: RAIN }, 17: { code: RAIN } }));
    expect(await checkStormChaserForecast()).toBe(true);
  });

  it('Open-Meteo svarar inte: inget event', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    expect(await checkStormChaserForecast()).toBe(false);
  });
});
