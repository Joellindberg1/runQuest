/**
 * convertWindToMs.ts — engångsomräkning av run_weather.wind_speed_ms / wind_gusts_ms från km/h till m/s (v0.5.3, issue #19).
 *
 * Före v0.5.3 hämtade WeatherService Open-Meteo utan `wind_speed_unit`, så kolumnerna som heter *_ms fick km/h.
 * Från v0.5.3 ber anropen om m/s och varje skrivning sätter fetched_at. Regeln blir då:
 *   fetched_at < --before  ⇔  vinden är i km/h.
 * --before ska vara tidpunkten då backend med v0.5.3 började köra (Railways deploy), inte "nu".
 *
 * Omräknade rader får fetched_at = nu, så de hamnar på m/s-sidan av gränsen: en omkörning med samma --before
 * hittar dem inte igen och delar aldrig två gånger.
 *
 * Körs:  npm run convert:wind-ms --workspace=@runquest/backend -- --before=<ISO-tid> [--apply --backup=<fil.json>]
 *   (default)  DRY-RUN: antal rader, urval före/efter, rör ingenting
 *   --apply    skriver säkerhetskopian (run_id + gamla värden + fetched_at) till --backup FÖRST, sedan raderna
 * Körs mot den databas miljön pekar på: --apply mot produktion kräver ägargodkännande (docs/permissions.md).
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { getSupabaseClient } from '../config/database.js';

type Client = ReturnType<typeof getSupabaseClient>;

export interface WindRow {
  run_id: string;
  wind_speed_ms: number | string | null;
  wind_gusts_ms: number | string | null;
  fetched_at: string;
}

export interface ConvertOptions {
  before: string;
  apply: boolean;
  backup: string | null;
}

export interface ConvertReport {
  options: ConvertOptions;
  rows: WindRow[];
  converted: Array<{ run_id: string; wind_speed_ms: number | null; wind_gusts_ms: number | null }>;
}

const PAGE = 1000;

/** km/h → m/s med en decimal, som kolumnen (numeric(4,1)) och Open-Meteos m/s-svar. */
export function kmhToMs(value: number | string | null): number | null {
  if (value == null) return null;
  const kmh = Number(value);
  if (!Number.isFinite(kmh)) return null;
  return Math.round((kmh / 3.6) * 10) / 10;
}

export function parseArgs(argv: string[]): ConvertOptions {
  const options: ConvertOptions = { before: '', apply: false, backup: null };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg.startsWith('--before=')) options.before = arg.slice('--before='.length);
    else if (arg.startsWith('--backup=')) options.backup = arg.slice('--backup='.length);
    else throw new Error(`Unknown argument "${arg}". Usage: --before=<ISO> [--apply --backup=<file.json>]`);
  }
  if (!options.before || Number.isNaN(Date.parse(options.before)) || !/T\d{2}:\d{2}/.test(options.before)) {
    throw new Error('--before=<ISO date-time> is required, e.g. --before=2026-10-06T10:15:00Z (when the v0.5.3 backend went live)');
  }
  if (options.apply && !options.backup) throw new Error('--apply needs --backup=<file.json> so the old values can be restored');
  return options;
}

async function loadKmhRows(supabase: Client, before: string): Promise<WindRow[]> {
  const rows: WindRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('run_weather')
      .select('run_id, wind_speed_ms, wind_gusts_ms, fetched_at')
      .lt('fetched_at', new Date(before).toISOString())
      .order('run_id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error?.code === 'PGRST103') return rows; // sidan ligger efter sista raden (exakt PAGE-multipel)
    if (error) throw new Error(`Could not read run_weather: ${error.message}`);
    rows.push(...((data ?? []) as WindRow[]));
    if (!data || data.length < PAGE) return rows;
  }
}

export async function runConversion(
  supabase: Client,
  options: ConvertOptions,
  writeBackup: (path: string, json: string) => void = writeFileSync,
  now: () => Date = () => new Date(),
): Promise<ConvertReport> {
  const rows = await loadKmhRows(supabase, options.before);
  const converted = rows.map((row) => ({
    run_id: row.run_id,
    wind_speed_ms: kmhToMs(row.wind_speed_ms),
    wind_gusts_ms: kmhToMs(row.wind_gusts_ms),
  }));

  if (options.apply && rows.length > 0) {
    writeBackup(options.backup!, JSON.stringify({ unit: 'km/h', before: options.before, rows }, null, 2));
    for (const row of converted) {
      const { error } = await supabase
        .from('run_weather')
        .update({ wind_speed_ms: row.wind_speed_ms, wind_gusts_ms: row.wind_gusts_ms, fetched_at: now().toISOString() })
        .eq('run_id', row.run_id);
      if (error) throw new Error(`Update failed for run ${row.run_id}: ${error.message} (backup: ${options.backup})`);
    }
  }
  return { options, rows, converted };
}

const max = (values: Array<number | string | null>) =>
  values.reduce<number | null>((top, v) => (v == null ? top : Math.max(top ?? -Infinity, Number(v))), null);

export function formatReport(report: ConvertReport): string {
  const { options, rows, converted } = report;
  const lines = [
    `run_weather wind km/h → m/s — ${options.apply ? 'APPLY' : 'DRY-RUN (nothing is written)'}`,
    `Rows fetched before ${options.before}: ${rows.length}`,
    `Max wind speed: ${max(rows.map((r) => r.wind_speed_ms))} km/h → ${max(converted.map((r) => r.wind_speed_ms))} m/s`,
    `Max gusts:      ${max(rows.map((r) => r.wind_gusts_ms))} km/h → ${max(converted.map((r) => r.wind_gusts_ms))} m/s`,
    'Sample (run_id: speed, gusts):',
    ...rows.slice(0, 5).map((r, i) =>
      `  ${r.run_id}: ${r.wind_speed_ms}, ${r.wind_gusts_ms} km/h → ${converted[i].wind_speed_ms}, ${converted[i].wind_gusts_ms} m/s`),
  ];
  lines.push(options.apply
    ? `${rows.length} row(s) converted. Backup of the old values: ${options.backup}`
    : `${rows.length} row(s) would be converted. Re-run with --apply --backup=<file.json> to write them.`);
  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runConversion(getSupabaseClient(), options);
  console.log(formatReport(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('❌ Conversion failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
