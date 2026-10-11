/**
 * Statiskt test (RUN-103): migration 037 lägger till titelraderna Stormborn, Iceborn och Winter Warrior
 * additivt och idempotent. Läser SQL-filen från disk — ingen databas.
 * (Körning två gånger mot en riktig Postgres-motor bevisades separat med PGlite, se RUN-103-rapporten.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { titleEngineRegistry } from '../../titleEngines';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  resolve(__dirname, '../../../migrations/037_add_weather_and_winter_titles.sql'),
  'utf8',
);
// Kommentarer bort så att rollback-satserna i headern inte räknas som körbar kod.
const code = sql.replace(/--.*$/gm, '');

interface TitleRow {
  name: string;
  description: string;
  unlockRequirement: number;
  metricKey: string;
  outdoorOnly: boolean;
}

// Parsar values-raderna: ('namn', 'beskrivning', krav, 'nyckel', true|false)
function parseRows(): TitleRow[] {
  const valuesPart = code.match(/\bvalues\b([\s\S]*?)\bon conflict\b/i)?.[1] ?? '';
  const rows: TitleRow[] = [];
  const re = /\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*([0-9.]+)\s*,\s*'([^']*)'\s*,\s*(true|false)\s*\)/gi;
  for (const m of valuesPart.matchAll(re)) {
    rows.push({
      name: m[1],
      description: m[2],
      unlockRequirement: Number(m[3]),
      metricKey: m[4],
      outdoorOnly: m[5].toLowerCase() === 'true',
    });
  }
  return rows;
}

describe('migration 037_add_weather_and_winter_titles.sql', () => {
  const rows = parseRows();

  it('lägger till exakt de tre raderna med rätt värden', () => {
    expect(rows).toEqual([
      {
        name: 'Stormborn',
        description: 'Most runs in gusts of 12 m/s or more.',
        unlockRequirement: 1,
        metricKey: 'stormRunCount',
        outdoorOnly: true,
      },
      {
        name: 'Iceborn',
        description: 'Most runs at 5 °C or colder.',
        unlockRequirement: 3,
        metricKey: 'coldRunCount',
        outdoorOnly: true,
      },
      {
        name: 'Winter Warrior',
        description:
          'Most kilometres in the current winter (December–February). Outside winter, the latest winter counts.',
        unlockRequirement: 10,
        metricKey: 'winterKm',
        outdoorOnly: false,
      },
    ]);
  });

  it('varje metric_key finns i titleEngineRegistry och unlock_requirement > 0', () => {
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(titleEngineRegistry.has(row.metricKey), `${row.metricKey} saknar motor`).toBe(true);
      expect(row.unlockRequirement).toBeGreaterThan(0);
    }
  });

  it('metric_key och name är unika inom migrationen', () => {
    expect(new Set(rows.map(r => r.metricKey)).size).toBe(rows.length);
    expect(new Set(rows.map(r => r.name)).size).toBe(rows.length);
  });

  it('infogar i public.titles med rätt kolumnlista', () => {
    expect(code).toMatch(
      /insert into public\.titles \(name, description, unlock_requirement, metric_key, outdoor_only\) values/i,
    );
  });

  it('idempotent: on conflict (metric_key) do nothing', () => {
    expect(code).toMatch(/on conflict \(metric_key\) do nothing\s*;/i);
    expect(code).not.toMatch(/do update/i);
  });

  it('additiv: inga drop/delete/update/truncate/alter, ingen egen transaktion', () => {
    expect(code).not.toMatch(/\b(drop\s+\w+|truncate|delete\s+from|update\s+\w|alter\s+table|rename\s+(to|column))\b/i);
    expect(code).not.toMatch(/\b(begin|commit|rollback)\b/i);
  });

  it('rollback-satserna finns som kommentar (inte som körbar kod)', () => {
    expect(sql).toMatch(/--\s+delete from public\.titles where metric_key in/i);
    expect(code).not.toMatch(/delete from/i);
  });
});
