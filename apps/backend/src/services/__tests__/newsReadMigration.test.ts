/**
 * Statiskt test: migration 049 skapar news_read, läst-kvitton per rad ovanför golvet users.news_last_seen_id (ADR 011 beslut 4, B3).
 * Läser SQL-filen från disk, ingen databas.
 *
 * Varför beteendet bara läses och inte körs här: cascade och RLS finns bara i Postgres, och prod är förbjudet i den här
 * leveransen. Testerna fäster därför det som gör beteendet: nyckeln (user_id, activity_id), de två FK:erna med on delete
 * cascade, hela kolumnlistan, indexet, RLS på utan policyer och revoke. Beviset i en riktig databas är frågorna mot katalogen
 * efter apply (se migrationens header).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, '../../../migrations');
const file = '049_create_news_read.sql';
const sql = readFileSync(resolve(migrationsDir, file), 'utf8');

// Kommentarer bort så att rollback-SQL:en i headern inte räknas som körbar kod.
const code = sql.replace(/--.*$/gm, '');
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const statements = code.split(';').map(normalize).filter(Boolean);
const createTable = statements.find((s) => s.startsWith('create table')) ?? '';

/** Delar innehållet mellan tabellens yttre parenteser vid kommatecken på djup 0 (references users(id) har egna parenteser). */
function tableElements(createStatement: string): string[] {
  const open = createStatement.indexOf('(');
  const close = createStatement.lastIndexOf(')');
  const body = createStatement.slice(open + 1, close);
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

describe(`migration ${file}`, () => {
  it('skapar news_read med sammansatt primärnyckel och cascade mot users och activity_log', () => {
    expect(createTable).toMatch(/^create table if not exists public\.news_read \(/);
    // Hela kolumnlistan och nyckeln fästs, i ordning: en ny, borttagen eller omtypad kolumn fäller testet.
    expect(tableElements(createTable)).toEqual([
      'user_id uuid not null references public.users(id) on delete cascade',
      'activity_id bigint not null references public.activity_log(id) on delete cascade',
      'read_at timestamptz not null default now()',
      'primary key (user_id, activity_id)',
    ]);
    // Exakt två referenser: users och activity_log, inget annat.
    expect(createTable.match(/\breferences\b/g)).toHaveLength(2);
    // Varken users eller activity_log rörs (golvet users.news_last_seen_id finns redan sedan 034).
    expect(code).not.toMatch(/\balter table (public\.)?(users|activity_log)\b/i);
  });

  it('har index på activity_id', () => {
    expect(statements).toContain('create index if not exists news_read_activity_idx on public.news_read (activity_id)');
    // Bara det indexet (primärnyckeln täcker user_id först): ingen oplanerad extra indexering.
    expect(statements.filter((s) => /^create (unique )?index\b/.test(s))).toHaveLength(1);
    // Indexet kommer efter create table.
    expect(statements.findIndex((s) => s.startsWith('create index'))).toBeGreaterThan(
      statements.findIndex((s) => s.startsWith('create table')),
    );
  });

  it('RLS är på, inga policyer finns och anon och authenticated har revoke', () => {
    expect(statements).toContain('alter table public.news_read enable row level security');
    expect(statements).toContain('revoke all on public.news_read from anon, authenticated');
    // Inga policyer = ingen åtkomst utom service role; inga grants som öppnar tabellen igen.
    expect(code).not.toMatch(/\bcreate policy\b|\balter policy\b/i);
    expect(code).not.toMatch(/\bgrant\b/i);
    expect(code).not.toMatch(/\bdisable row level security\b|\bno force row level security\b/i);
    // Revoke kommer efter create table, annars finns inget att dra in rättigheter från.
    expect(statements.indexOf('revoke all on public.news_read from anon, authenticated')).toBeGreaterThan(
      statements.findIndex((s) => s.startsWith('create table')),
    );
  });

  it('migrationen är additiv och idempotent (create table if not exists, inga drop, rename, truncate eller delete)', () => {
    expect(createTable).toMatch(/^create table if not exists\b/);
    // "on delete cascade" i FK:erna är tillåtet; det som inte får finnas är satser som tar bort eller ändrar data eller schema.
    expect(code).not.toMatch(/\b(drop|rename|truncate|delete from|insert|update)\b/i);
    expect(code).not.toMatch(/\bdelete\b(?!\s+cascade)/i);
    // Ingen backfill och ingen schemaändring av befintliga tabeller (enda alter table är RLS på den nya tabellen).
    expect(statements.filter((s) => s.startsWith('alter table'))).toEqual(['alter table public.news_read enable row level security']);
    // Ingen egen transaktionsstyrning: apply_migration kör filen som en transaktion.
    expect(code).not.toMatch(/\b(begin|commit|rollback)\b/i);
    // Lås: set local gäller bara transaktionen och kommer före den första sats som tar lås (FK mot users och activity_log).
    expect(statements[0]).toBe("set local lock_timeout = '5s'");
    expect(code).not.toMatch(/\bset\s+(session\s+)?lock_timeout\b/i);
  });

  it('header has a commented rollback that drops only news_read', () => {
    const rollback = sql
      .split('\n')
      .filter((l) => /^--\s+drop\b/i.test(l))
      .map((l) => normalize(l.replace(/^--\s*/, '')));
    expect(rollback).toEqual(['drop table if exists public.news_read;']);
  });
});
