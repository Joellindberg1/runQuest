/**
 * Static check of the database rules the Strava deletion chain relies on (ADR 010 decision 8.2): deleting a runs row must not fail on
 * a foreign key and must leave the right things behind. Reads the migrations from disk; the SQL itself is run against a real
 * Postgres (PGlite) by the critic. createFakeDb models no foreign keys, so the behaviour tests of the chain use
 * test-utils/runForeignKeys.ts, which repeats these rules.
 *   run_weather.run_id         ON DELETE CASCADE   (the weather row goes with the run)
 *   user_badges.source_run_id  ON DELETE SET NULL  (the badge stays until evaluateBadges recalculates it)
 *   event_entries.run_id       ON DELETE SET NULL  (migration 047; the entry and its XP stay - D2; own test: eventEntriesRunIdMigration047.test.ts)
 * and that no other table points at runs(id) without an ON DELETE rule, which would make the delete throw for the user it hits.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUN_FOREIGN_KEYS } from '../../test-utils/runForeignKeys.js';

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../migrations');
const files = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
const code = (name: string) => readFileSync(resolve(migrationsDir, name), 'utf8').replace(/--.*$/gm, '');

// Every `references [public.]runs(id) [on delete ...]` clause with the file it is in.
const references = files.flatMap((file) =>
  [...code(file).matchAll(/references\s+(?:public\.)?runs\s*\(\s*id\s*\)(\s+on\s+delete\s+(cascade|set\s+null|restrict|no\s+action))?/gi)].map((match) => ({
    file,
    action: (match[2] ?? 'no action').toLowerCase().replace(/\s+/g, ' '),
  })),
);

describe('the foreign keys to runs(id)', () => {
  it('run_weather goes with the run and user_badges.source_run_id is cleared', () => {
    expect(code('000_baseline.sql')).toMatch(/alter table run_weather add constraint run_weather_run_id_fkey foreign key \(run_id\) references runs\(id\) on delete cascade/i);
    expect(code('035_create_user_badges.sql')).toMatch(/source_run_id\s+uuid\s+references public\.runs\(id\) on delete set null/i);
  });

  it('only event_entries can still have an unqualified key, and 047 replaces it with ON DELETE SET NULL', () => {
    const noRule = references.filter((reference) => reference.action === 'no action');
    expect(noRule.map((reference) => reference.file)).toEqual(['000_baseline.sql', '016_create_event_entries.sql']); // both define event_entries.run_id
    expect(code('000_baseline.sql')).toMatch(/alter table event_entries add constraint event_entries_run_id_fkey foreign key \(run_id\) references runs\(id\);/i);
    expect(code('016_create_event_entries.sql')).toMatch(/run_id\s+uuid\s+references runs\(id\),/i);
    expect(code('047_event_entries_run_id_set_null.sql')).toMatch(/event_entries_run_id_fkey\s+foreign key \(run_id\) references public\.runs\(id\) on delete set null/i);
  });

  it('every other reference to runs(id) has an ON DELETE rule that lets the run go', () => {
    const others = references.filter((reference) => reference.action !== 'no action');
    expect(others.map((reference) => `${reference.file}:${reference.action}`)).toEqual([
      '000_baseline.sql:cascade',
      '013_create_run_weather.sql:cascade',
      '035_create_user_badges.sql:set null',
      '047_event_entries_run_id_set_null.sql:set null',
    ]);
  });

  it('the model used by the behaviour tests lists exactly these three tables', () => {
    expect(RUN_FOREIGN_KEYS.map(({ table, column, onDelete }) => `${table}.${column}:${onDelete}`).sort()).toEqual([
      'event_entries.run_id:set null',
      'run_weather.run_id:cascade',
      'user_badges.source_run_id:set null',
    ]);
  });
});
