/**
 * Statiskt test (RUN-158): migration 042 serialiserar update_title_leaderboard per titel med
 * pg_advisory_xact_lock och bevarar resten av funktionen oförändrad. Läser SQL-filerna från disk — ingen databas.
 *
 * Varför inget fakeDb-repro av själva låset: låssemantiken (väntan, ny ögonblicksbild per sats efter låset) finns
 * bara i Postgres; en JS-modell av den skulle bevisa modellen, inte SQL:en. Racet som låset stänger är redan
 * modellerat i enhetstestet enhancedTitleService.race.test.ts (RUN-157). Här bevisas därför att låset finns, att det
 * sitter FÖRST och är nyckeln per titel, och att allt annat är identiskt med produktionsfunktionen i baslinjen.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, '../../../migrations');
const sql = readFileSync(resolve(migrationsDir, '042_title_leaderboard_advisory_lock.sql'), 'utf8');
const baseline = readFileSync(resolve(migrationsDir, '000_baseline.sql'), 'utf8');

// Kommentarer bort så att rollback-SQL:en i headern inte räknas som körbar kod.
const code = sql.replace(/--.*$/gm, '');

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function functionDefinition(source: string): string {
  const match = source.match(/create or replace function public\.update_title_leaderboard\(p_title_id uuid\)[\s\S]*?\$function\$;/i);
  expect(match, 'update_title_leaderboard saknas').not.toBeNull();
  return match![0];
}

const LOCK = /perform pg_advisory_xact_lock\(hashtextextended\('title_leaderboard:' \|\| p_title_id::text, 0\)\);/i;

describe('migration 042_title_leaderboard_advisory_lock.sql', () => {
  const migrationFn = functionDefinition(code);
  const baselineFn = functionDefinition(baseline);

  it('redefinierar bara update_title_leaderboard(uuid) — create or replace, ingen annan DDL', () => {
    expect(code.match(/create\s+or\s+replace\s+function/gi)).toHaveLength(1);
    expect(code).not.toMatch(/\b(drop\s+\w+|truncate|alter\s+\w+|create\s+(table|trigger|policy|index|view)|grant|revoke|insert\s+into\s+public\.(titles|users)|delete\s+from\s+public\.(titles|users))\b/i);
  });

  it('tar ett transaktionslås per titel, nycklat på p_title_id', () => {
    expect(migrationFn).toMatch(LOCK);
    expect(code).not.toMatch(/pg_advisory_lock\(|pg_try_advisory/i); // xact-varianten: släpps vid transaktionens slut
  });

  it('låset är första satsen — före DELETE, INSERT och UPDATE', () => {
    const lockAt = migrationFn.search(LOCK);
    const body = migrationFn.slice(migrationFn.search(/\bbegin\b/i));
    const firstStatement = body.replace(/^begin\s*/i, '').replace(/^\s*--.*$/gm, '').trimStart();
    expect(firstStatement.toLowerCase().startsWith('perform pg_advisory_xact_lock')).toBe(true);
    for (const dml of [/delete from public\.title_leaderboard/i, /insert into public\.title_leaderboard/i, /update public\.titles/i]) {
      expect(migrationFn.search(dml)).toBeGreaterThan(lockAt);
    }
  });

  it('bevarar allt annat: utan låsraden är funktionen identisk med baslinjens (signatur, search_path, kropp)', () => {
    const withoutLock = migrationFn.replace(LOCK, '');
    expect(normalize(withoutLock)).toBe(normalize(baselineFn));
  });

  it('behåller signatur uuid -> void och search_path tom (som i prod)', () => {
    expect(migrationFn).toMatch(/\(p_title_id uuid\)\s+returns void/i);
    expect(migrationFn).toMatch(/set search_path to ''/i);
    expect(migrationFn).toMatch(/language plpgsql/i);
  });

  it('idempotent och utan egen transaktion', () => {
    expect(code).not.toMatch(/\b(begin|commit|rollback)\s*;/i);
  });

  it('headern anger körordning och rollback-SQL', () => {
    expect(sql).toMatch(/KÖRORDNING/);
    expect(sql).toMatch(/Rollback/);
    // Applikationsstatus står i headern (EJ APPLICERAD före prod, APPLICERAD i prod efter).
    expect(sql).toMatch(/APPLICERAD/);
    // Rollbacken är den ursprungliga funktionen utan låset.
    const rollback = sql.split('\n').filter((l) => /^--   /.test(l)).map((l) => l.replace(/^--   /, '')).join('\n');
    expect(rollback).toMatch(/create or replace function public\.update_title_leaderboard/i);
    expect(rollback).not.toMatch(/advisory/i);
  });
});
