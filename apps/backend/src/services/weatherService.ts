import { getSupabaseClient } from '../config/database.js';
import { logger } from '../utils/logger.js';

interface RunForWeather {
  id: string;
  start_lat: number | null;
  start_lng: number | null;
  start_time: string | null;
  moving_time: number | null; // seconds
  is_treadmill: boolean | null;
}

interface WeatherData {
  temperature_c: number | null;
  apparent_temp_c: number | null;
  humidity_pct: number | null;
  precipitation_mm: number | null;
  snowfall_cm: number | null;
  snow_depth_cm: number | null;
  wind_speed_ms: number | null;
  wind_gusts_ms: number | null;
  wind_direction_deg: number | null;
  weather_code: number | null;
  uv_index: number | null;
  visibility_m: number | null;
}

const OPEN_METEO_HOURLY_FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'precipitation',
  'snowfall',
  'snow_depth',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'weather_code',
  'uv_index',
  'visibility',
].join(',');

// Runs äldre än 3 dagar hämtas från archive-API:et,
// nyare hämtas från forecast-API:et med past_hours.
const FORECAST_CUTOFF_HOURS = 72;

export class WeatherService {
  static async fetchAndSaveWeatherForRuns(runs: RunForWeather[]): Promise<void> {
    const eligible = runs.filter(run => this.isEligible(run));

    if (eligible.length === 0) return;

    logger.info(`[WeatherService] Fetching weather for ${eligible.length} run(s)`);

    for (const run of eligible) {
      await this.fetchAndSaveWeatherForRun(run);
      if (eligible.length > 1) {
        await delay(200);
      }
    }
  }

  static async fetchAndSaveWeatherForRun(run: RunForWeather): Promise<void> {
    try {
      const weather = await this.fetchWeather(run);
      if (!weather) return;

      await this.saveWeather(run.id, weather);
      logger.info(`[WeatherService] Saved weather for run ${run.id}`);
    } catch (err) {
      logger.warn(`[WeatherService] Failed to fetch weather for run ${run.id}:`, err);
    }
  }

  // Anropas från cron-jobbet för att backfilla och retria misslyckade hämtningar.
  static async backfillMissingWeather(): Promise<void> {
    const supabase = getSupabaseClient();

    const { data: runs, error } = await supabase
      .from('runs')
      .select('id, start_lat, start_lng, start_time, moving_time, is_treadmill')
      .eq('is_treadmill', false)
      .not('start_lat', 'is', null)
      .not('start_time', 'is', null);

    if (error || !runs || runs.length === 0) {
      if (error) logger.warn('[WeatherService] backfill query failed:', error);
      return;
    }

    // Filtrera bort runs som redan har väderdata
    const { data: existing } = await supabase
      .from('run_weather')
      .select('run_id');

    const existingIds = new Set((existing ?? []).map((r: { run_id: string }) => r.run_id));
    const missing = runs.filter((r: RunForWeather) => !existingIds.has(r.id));

    if (missing.length === 0) return;

    logger.info(`[WeatherService] Backfilling weather for ${missing.length} run(s)`);

    for (const run of missing) {
      await this.fetchAndSaveWeatherForRun(run);
      await delay(200);
    }
  }

  private static isEligible(run: RunForWeather): boolean {
    if (run.is_treadmill) return false;
    if (!run.start_lat || !run.start_lng) return false;
    if (!run.start_time) return false;
    return true;
  }

  private static async fetchWeather(run: RunForWeather): Promise<WeatherData | null> {
    const startTime = new Date(run.start_time!);
    const hoursSinceRun = (Date.now() - startTime.getTime()) / (1000 * 60 * 60);

    const url =
      hoursSinceRun <= FORECAST_CUTOFF_HOURS
        ? this.buildForecastUrl(run.start_lat!, run.start_lng!, hoursSinceRun)
        : this.buildArchiveUrl(run.start_lat!, run.start_lng!, startTime);

    const res = await fetch(url, {
      headers: { 'User-Agent': 'RunQuest/1.0 (weather data for running app)' },
    });

    if (!res.ok) {
      logger.warn(`[WeatherService] Open-Meteo responded ${res.status} for run ${run.id}`);
      return null;
    }

    const json = await res.json() as any;
    return this.extractHourlyData(json, startTime);
  }

  private static buildForecastUrl(lat: number, lng: number, hoursSinceRun: number): string {
    const pastHours = Math.ceil(hoursSinceRun) + 2; // lite marginal
    return (
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lng}` +
      `&hourly=${OPEN_METEO_HOURLY_FIELDS}` +
      `&past_hours=${pastHours}` +
      `&forecast_hours=1` +
      `&timezone=Europe%2FStockholm`
    );
  }

  private static buildArchiveUrl(lat: number, lng: number, startTime: Date): string {
    const date = startTime.toISOString().split('T')[0];
    return (
      `https://archive-api.open-meteo.com/v1/archive` +
      `?latitude=${lat}&longitude=${lng}` +
      `&start_date=${date}&end_date=${date}` +
      `&hourly=${OPEN_METEO_HOURLY_FIELDS}` +
      `&timezone=Europe%2FStockholm`
    );
  }

  private static extractHourlyData(json: any, startTime: Date): WeatherData | null {
    const times: string[] = json?.hourly?.time;
    if (!times || times.length === 0) return null;

    // Hitta index för den timme som bäst matchar löpturens starttid
    const targetHour = startTime.toISOString().slice(0, 13); // "2026-03-24T10"
    const index = times.findIndex(t => t.startsWith(targetHour));

    if (index === -1) {
      logger.warn(`[WeatherService] Could not find matching hour (${targetHour}) in Open-Meteo response`);
      return null;
    }

    const h = json.hourly;
    return {
      temperature_c:      h.temperature_2m?.[index] ?? null,
      apparent_temp_c:    h.apparent_temperature?.[index] ?? null,
      humidity_pct:       h.relative_humidity_2m?.[index] ?? null,
      precipitation_mm:   h.precipitation?.[index] ?? null,
      snowfall_cm:        h.snowfall?.[index] ?? null,
      snow_depth_cm:      h.snow_depth?.[index] ?? null,
      wind_speed_ms:      h.wind_speed_10m?.[index] ?? null,
      wind_gusts_ms:      h.wind_gusts_10m?.[index] ?? null,
      wind_direction_deg: h.wind_direction_10m?.[index] ?? null,
      weather_code:       h.weather_code?.[index] ?? null,
      uv_index:           h.uv_index?.[index] ?? null,
      visibility_m:       h.visibility?.[index] ?? null,
    };
  }

  private static async saveWeather(runId: string, weather: WeatherData): Promise<void> {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('run_weather')
      .upsert({ run_id: runId, ...weather }, { onConflict: 'run_id' });

    if (error) {
      throw new Error(`Failed to save weather: ${error.message}`);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
