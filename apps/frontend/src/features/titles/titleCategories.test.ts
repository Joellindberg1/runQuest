import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RQ_ICON_NAMES } from '@/shared/components/icons/rq-icon-paths';
import { MAPPED_METRIC_KEYS, TITLE_CATEGORIES, categoryOf, iconOf } from './titleCategories';
import { TITLE_ENGINE_METRIC_KEYS } from './titleMetricKeys.fixture';

describe('kategorimappningen metric_key → grupp', () => {
  it('fixturen har de 21 motorerna', () => {
    expect(TITLE_ENGINE_METRIC_KEYS).toHaveLength(21);
    expect(new Set(TITLE_ENGINE_METRIC_KEYS).size).toBe(21);
  });

  it.each(TITLE_ENGINE_METRIC_KEYS)('%s är mappad till en riktig kategori (inte Other)', (key) => {
    const category = categoryOf(key);
    expect(category).not.toBe('other');
    expect(TITLE_CATEGORIES.map((def) => def.id)).toContain(category);
  });

  it('en okänd nyckel faller i Other — en ny titel försvinner inte ur vyn', () => {
    expect(categoryOf('someFutureMetric')).toBe('other');
    expect(categoryOf(undefined)).toBe('other');
    expect(categoryOf('')).toBe('other');
  });

  it('ärver inte från Object.prototype ("constructor" är en okänd nyckel)', () => {
    expect(categoryOf('constructor')).toBe('other');
    expect(categoryOf('toString')).toBe('other');
  });

  it('mappningen innehåller exakt motorernas nycklar — inget kvarglömt, inget saknas', () => {
    expect([...MAPPED_METRIC_KEYS].sort()).toEqual([...TITLE_ENGINE_METRIC_KEYS].sort());
  });

  it('varje kategori som mappningen pekar på har en deklaration, och Other ligger sist', () => {
    const ids = TITLE_CATEGORIES.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.at(-1)).toBe('other');
    for (const key of TITLE_ENGINE_METRIC_KEYS) expect(ids).toContain(categoryOf(key));
  });

  it('ikonerna finns i RQIcon-uppsättningen; okänd nyckel får Others ikon', () => {
    for (const key of TITLE_ENGINE_METRIC_KEYS) expect(RQ_ICON_NAMES).toContain(iconOf(key));
    expect(iconOf('someFutureMetric')).toBe('trophy');
    expect(iconOf(undefined)).toBe('trophy');
  });
});

describe('driftvakt mot backendens motorregister', () => {
  // Backendens motorer: en fil per motor med `metricKey: '…'`. Läses från disk, så en ny motor utan rad i
  // fixturen (och därmed i mappningen) fäller testet i stället för att tyst landa i Other.
  const enginesDir = resolve(process.cwd(), '../backend/src/titleEngines');
  const engineKeys = readdirSync(enginesDir)
    .filter((file) => file.endsWith('.ts') && !['index.ts', 'types.ts', '_utils.ts'].includes(file))
    .map((file) => readFileSync(resolve(enginesDir, file), 'utf8').match(/metricKey:\s*'([^']+)'/)?.[1]);

  it('hittar motorfilerna', () => {
    expect(engineKeys.length).toBeGreaterThan(15);
    expect(engineKeys).not.toContain(undefined);
  });

  it('fixturen == motorregistret', () => {
    expect([...(engineKeys as string[])].sort()).toEqual([...TITLE_ENGINE_METRIC_KEYS].sort());
  });
});
