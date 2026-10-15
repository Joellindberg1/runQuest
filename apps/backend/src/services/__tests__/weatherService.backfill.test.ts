/**
 * RUN-99 T5 — backfillMissingWeather rapporterar hur många väderrader som faktiskt sparades, så att
 * stravaSync bara räknar om titlarna när något nytt väder finns att räkna på.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const holder = vi.hoisted(() => ({ client: null as any }));

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(() => holder.client),
}));

import { WeatherService } from '../weatherService.js';

type Row = Record<string, any>;

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

const runRow = (id: string, start: string): Row => ({
  id, start_lat: 59.33, start_lng: 18.07, start_time: start, moving_time: 1800, is_treadmill: false,
});

interface StubOptions { runsError?: { message: string }; upsertError?: { message: string } }

/** Bara de anrop backfillen gör: runs-frågan (kedjad), run_weather-listan och run_weather-upserten. */
function stubClient(runs: Row[], weather: Row[], opts: StubOptions = {}) {
  const saved: Row[] = [];
  holder.client = {
    from(table: string) {
      if (table === 'runs') {
        const chain: any = {
          select: () => chain, eq: () => chain, not: () => chain,
          then: (resolve: (v: unknown) => void) => resolve(opts.runsError ? { data: null, error: opts.runsError } : { data: runs, error: null }),
        };
        return chain;
      }
      return {
        select: async () => ({ data: weather, error: null }),
        upsert: async (row: Row) => {
          if (opts.upsertError) return { error: opts.upsertError };
          saved.push(row);
          return { error: null };
        },
      };
    },
  };
  return saved;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('backfillMissingWeather — returnerar antal sparade rader', () => {
  it('backfillMissingWeather returnerar antal sparade rader', async () => {
    const a = '2026-09-01T07:00:00.000Z';
    const b = '2026-09-02T07:00:00.000Z';
    const saved = stubClient([runRow('r1', a), runRow('r2', b)], []);
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true, status: 200, json: async () => hourly(String(url).includes('2026-09-01') ? a : b),
    }));

    expect(await WeatherService.backfillMissingWeather()).toBe(2);
    expect(saved.map(r => r.run_id).sort()).toEqual(['r1', 'r2']);
  });

  it('räknar bara lyckade: en misslyckad hämtning (HTTP 500) ger inte en sparad rad', async () => {
    const a = '2026-09-01T07:00:00.000Z';
    const b = '2026-09-02T07:00:00.000Z';
    stubClient([runRow('r1', a), runRow('r2', b)], []);
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('2026-09-01')
        ? { ok: true, status: 200, json: async () => hourly(a) }
        : { ok: false, status: 500, json: async () => ({}) });

    expect(await WeatherService.backfillMissingWeather()).toBe(1);
  });

  it('ett skrivfel räknas inte som sparad', async () => {
    const a = '2026-09-01T07:00:00.000Z';
    stubClient([runRow('r1', a)], [], { upsertError: { message: 'boom' } });
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => hourly(a) });

    expect(await WeatherService.backfillMissingWeather()).toBe(0);
  });

  it('inget saknas → 0 och inget nätverksanrop', async () => {
    stubClient([runRow('r1', '2026-09-01T07:00:00.000Z')], [{ run_id: 'r1' }]);
    expect(await WeatherService.backfillMissingWeather()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('inga rundor alls → 0; frågefel → 0', async () => {
    stubClient([], []);
    expect(await WeatherService.backfillMissingWeather()).toBe(0);

    stubClient([], [], { runsError: { message: 'down' } });
    expect(await WeatherService.backfillMissingWeather()).toBe(0);
  });
});

describe('Open-Meteo calls have a time limit', () => {
  it('a hanging weather fetch is aborted after 15 seconds and the backfill moves on', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    stubClient([runRow('r1', '2026-09-01T07:00:00.000Z')], []);
    // A fetch that never answers and only ends when its signal is aborted.
    fetchMock.mockImplementation((_url: string, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    }));

    const backfill = WeatherService.backfillMissingWeather();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(timeout).toHaveBeenCalledWith(15_000);
    controller.abort(new DOMException('timed out', 'TimeoutError'));

    await expect(backfill).resolves.toBe(0);
    timeout.mockRestore();
  });
});
