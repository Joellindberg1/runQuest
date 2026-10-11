/**
 * Statiska tester (ADR 008 beslut 1, ADR 009 beslut 5): CHECK-listan för activity_log.type i den SENASTE migrationen som
 * definierar activity_log_type_check måste vara identisk med ACTIVITY_TYPES i shared (EN källa i kod). 034 skapar tabellen
 * och CHECK:en; 036 byter CHECK:en (drop + add) för att lägga till badge_earned. Läser SQL-filerna från disk — ingen databas.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIVITY_TYPES } from '@runquest/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, '../../../migrations');

// Kommentarer bort så att exempel i headern inte räknas.
const stripComments = (sql: string): string => sql.replace(/--.*$/gm, '');
const readMigration = (file: string): string => stripComments(readFileSync(resolve(migrationsDir, file), 'utf8'));

const TYPE_CHECK = /activity_log_type_check\s+check\s*\(\s*type\s+in\s*\(([^)]*)\)/i;
const checkValues = (code: string): string[] | null => {
  const match = code.match(TYPE_CHECK);
  return match ? [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : null;
};

/** Migrationerna är globala och kronologiska (NNN_namn.sql); den senaste som definierar CHECK:en gäller. */
const typeCheckMigrations = readdirSync(migrationsDir)
  .filter((file) => /^\d+_.+\.sql$/.test(file))
  .sort()
  .filter((file) => TYPE_CHECK.test(readMigration(file)));
const latestFile = typeCheckMigrations[typeCheckMigrations.length - 1];

const sql034 = readMigration('034_create_activity_log.sql');
const sql036 = readMigration('036_activity_log_badge_earned.sql');
const sql041 = readMigration('041_activity_log_release_published.sql');
// 034 definierar tabellen; resten av filen testas mot dess kod.
const code = sql034;

describe('activity_log_type_check — senaste migrationen som definierar CHECK:en', () => {
  it('CHECK-listan i senaste migrationen som definierar activity_log_type_check == ACTIVITY_TYPES (samma värden, samma antal)', () => {
    expect(latestFile, 'ingen migration definierar activity_log_type_check').toBeDefined();
    const values = checkValues(readMigration(latestFile));
    expect(values, `type-CHECK hittades inte i ${latestFile}`).not.toBeNull();
    expect([...values!].sort()).toEqual([...ACTIVITY_TYPES].sort());
    expect(new Set(values).size).toBe(values!.length);
  });

  it('034 behåller sin ursprungliga lista: ADR 008:s elva typer, utan badge_earned (historik skrivs inte om)', () => {
    const values = checkValues(sql034)!;
    expect(values).toHaveLength(11);
    expect(values).not.toContain('badge_earned');
    expect([...ACTIVITY_TYPES].filter((type) => !values.includes(type))).toEqual(['badge_earned', 'release_published']);
  });

  it('036 behåller sin lista: 034 + badge_earned, utan release_published (historik skrivs inte om)', () => {
    const values = checkValues(sql036)!;
    expect(values).toContain('badge_earned');
    expect(values).not.toContain('release_published');
    expect([...ACTIVITY_TYPES].filter((type) => !values.includes(type))).toEqual(['release_published']);
  });
});

describe('migration 041_activity_log_release_published.sql', () => {
  it('är bara ett constraint-byte: drop + add av activity_log_type_check på activity_log, inget annat', () => {
    const statements = sql041
      .split(';')
      .map((statement) => statement.replace(/\s+/g, ' ').trim())
      .filter((statement) => statement !== '');
    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatch(/^alter table public\.activity_log drop constraint if exists activity_log_type_check$/i);
    expect(statements[1]).toMatch(/^alter table public\.activity_log add constraint activity_log_type_check check \(type in \(/i);
    expect(sql041).not.toMatch(/\b(create|insert|update|delete|truncate|rename|grant|revoke|policy)\b/i);
    expect(sql041).not.toMatch(/\bdrop\s+(table|column|index)\b/i);
  });

  it('ingen egen transaktionsram och idempotent (drop … if exists före add)', () => {
    expect(sql041).not.toMatch(/\b(begin|commit|rollback|start\s+transaction)\b/i);
    expect(sql041.search(/drop constraint if exists activity_log_type_check/i)).toBeGreaterThan(-1);
    expect(sql041.search(/drop constraint if exists/i)).toBeLessThan(sql041.search(/add constraint/i));
  });

  it('listan är 036:s lista + release_published (additivt, inget försvinner)', () => {
    const values041 = checkValues(sql041)!;
    expect(values041).toContain('release_published');
    for (const type of checkValues(sql036)!) expect(values041).toContain(type);
    expect(values041).toHaveLength(checkValues(sql036)!.length + 1);
  });
});

describe('migration 036_activity_log_badge_earned.sql', () => {
  it('är bara ett constraint-byte: drop + add av activity_log_type_check på activity_log, inget annat', () => {
    const statements = sql036
      .split(';')
      .map((statement) => statement.replace(/\s+/g, ' ').trim())
      .filter((statement) => statement !== '');
    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatch(/^alter table public\.activity_log drop constraint if exists activity_log_type_check$/i);
    expect(statements[1]).toMatch(/^alter table public\.activity_log add constraint activity_log_type_check check \(type in \(/i);
    expect(sql036).not.toMatch(/\b(create|insert|update|delete|truncate|rename|grant|revoke|policy)\b/i);
    expect(sql036).not.toMatch(/\bdrop\s+(table|column|index)\b/i);
  });

  it('ingen egen transaktionsram (apply_migration äger transaktionen) och idempotent (drop … if exists före add)', () => {
    expect(sql036).not.toMatch(/\b(begin|commit|rollback|start\s+transaction)\b/i);
    expect(sql036.search(/drop constraint if exists activity_log_type_check/i)).toBeGreaterThan(-1);
    expect(sql036.search(/drop constraint if exists/i)).toBeLessThan(sql036.search(/add constraint/i));
  });

  it('listan innehåller badge_earned och alla typer i 034 (additivt utökad, inget försvinner)', () => {
    const values036 = checkValues(sql036)!;
    expect(values036).toContain('badge_earned');
    for (const type of checkValues(sql034)!) expect(values036).toContain(type);
  });
});

describe('migration 034_create_activity_log.sql', () => {

  it('dedupe_key är not null + unik, id är monoton identitet', () => {
    expect(code).toMatch(/dedupe_key\s+text\s+not null/i);
    expect(code).toMatch(/constraint\s+activity_log_dedupe_key_key\s+unique\s*\(dedupe_key\)/i);
    expect(code).toMatch(/id\s+bigint\s+generated always as identity primary key/i);
  });

  it('RLS på, ingen policy, ingen anon-/authenticated-åtkomst (ADR 008 beslut 10)', () => {
    expect(code).toMatch(/alter table public\.activity_log enable row level security/i);
    expect(code).toMatch(/revoke all on public\.activity_log from anon, authenticated/i);
    expect(code).not.toMatch(/create policy/i);
  });

  it('is_backfill och keyset-index (group_id, id desc) finns; users.news_last_seen_id läggs additivt', () => {
    expect(code).toMatch(/is_backfill\s+boolean\s+not null default false/i);
    expect(code).toMatch(/activity_log_group_id_idx\s+on public\.activity_log \(group_id, id desc\)/i);
    expect(code).toMatch(/alter table public\.users add column if not exists news_last_seen_id bigint/i);
  });

  it('är additiv: inga drop/rename/delete', () => {
    // "on delete cascade/set null" på FK:erna är tillåtet — här söks destruktiva satser.
    expect(code).not.toMatch(/\b(drop\s+(table|column|index|constraint)|rename\s+(to|column)|truncate|delete\s+from)\b/i);
  });
});
