/**
 * Storm Chaser-prognosen (issue #19): byarna ska jämföras i m/s. Open-Meteo levererar km/h om inte
 * `wind_speed_unit=ms` skickas, och då blir tröskeln 15 km/h (≈ 4 m/s) — en vanlig bris.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
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

/**
 * RUN-218 T4 — "imorgon" är Stockholm-dagen. Open-Meteo svarar med Stockholm-tid, men imorgondatumet togs ur UTC
 * (`new Date()` + 1 dag, toISOString): mellan Stockholm-midnatt och UTC-midnatt letade prognoskollen efter dagens
 * datum i stället för morgondagens.
 */
describe('checkStormChaserForecast — imorgon i Stockholm-tid', () => {
  function forecastFor(day: string, hours: Record<number, { code?: number; gust?: number }>) {
    const time: string[] = [];
    const weather_code: number[] = [];
    const wind_gusts_10m: number[] = [];
    for (const d of ['2026-07-04', '2026-07-05', '2026-07-06', '2026-12-31', '2027-01-01', '2027-01-02']) {
      for (let h = 0; h < 24; h++) {
        time.push(`${d}T${String(h).padStart(2, '0')}:00`);
        weather_code.push(d === day ? (hours[h]?.code ?? CLEAR) : CLEAR);
        wind_gusts_10m.push(d === day ? (hours[h]?.gust ?? 3) : 3);
      }
    }
    return { hourly: { time, weather_code, wind_gusts_10m } };
  }

  it('sommar: 00:30 Stockholm den 5 juli (22:30 UTC den 4:e) -> prognosen för den 6:e avgör', async () => {
    vi.setSystemTime(new Date('2026-07-04T22:30:00.000Z'));
    respond(forecastFor('2026-07-06', gusty(10, 4, 20)));
    expect(await checkStormChaserForecast()).toBe(true);
  });

  it('sommar: storm bara den 5:e (idag i Stockholm) kvalificerar inte', async () => {
    vi.setSystemTime(new Date('2026-07-04T22:30:00.000Z'));
    respond(forecastFor('2026-07-05', gusty(10, 4, 20)));
    expect(await checkStormChaserForecast()).toBe(false);
  });

  it('vinter över årsskiftet: 00:30 Stockholm den 1 jan (23:30 UTC den 31 dec) -> prognosen för den 2:a avgör', async () => {
    vi.setSystemTime(new Date('2026-12-31T23:30:00.000Z'));
    respond(forecastFor('2027-01-02', gusty(10, 4, 20)));
    expect(await checkStormChaserForecast()).toBe(true);
  });

  it('mitt på dagen (Stockholm- och UTC-dag lika) är oförändrat: prognosen för nästa dag avgör', async () => {
    vi.setSystemTime(new Date('2026-07-04T10:00:00.000Z'));
    respond(forecastFor('2026-07-05', gusty(10, 4, 20)));
    expect(await checkStormChaserForecast()).toBe(true);
  });
});
