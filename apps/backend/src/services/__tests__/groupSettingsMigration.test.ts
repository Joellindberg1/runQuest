/**
 * Statiskt test: migration 054 skapar group_settings, en gles tabell med en rad per (grupp, nyckel) (ADR 012 beslut 6).
 * Läser SQL-filen från disk, ingen databas.
 *
 * Varför beteendet bara läses och inte körs här: cascade, set null, CHECK och RLS finns bara i Postgres. Testerna fäster därför det
 * som gör beteendet: nyckeln (group_id, key), de två främmande nycklarna och deras ON DELETE-regler, CHECK-gränserna, RLS på utan
 * policyer och revoke. Beviset i en riktig databas är katalogfrågorna i migrationens header, som Lead kör efter apply.
 *
 * Beroenden: migrationen får bara peka på groups och users (som finns sedan baseline). Den får inte bero på group_members
 * (migration 053 byggs separat), eftersom roll och medlemskap prövas i koden (resolveActingGroupForWrite), inte i databasen.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SETTING_DEFINITIONS } from '@runquest/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, '../../../migrations');
const file = '054_create_group_settings.sql';
const sql = readFileSync(resolve(migrationsDir, file), 'utf8');

// Kommentarer bort så att rollback-SQL:en i headern inte räknas som körbar kod.
const code = sql.replace(/--.*$/gm, '');
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const statements = code.split(';').map(normalize).filter(Boolean);
const createTable = statements.find((s) => s.startsWith('create table')) ?? '';
const revoke = 'revoke all on public.group_settings from anon, authenticated';

describe(`migration ${file}`, () => {
  it('creates group_settings with primary key (group_id, key) and on delete cascade against groups', () => {
    expect(createTable).toMatch(/^create table if not exists public\.group_settings \(/);
    expect(createTable).toContain('group_id uuid not null references public.groups(id) on delete cascade');
    expect(createTable).toContain('primary key (group_id, key)');
    expect(createTable).toContain('updated_at timestamptz not null default now()');
    // groups och users är de enda som pekas på; users själv rörs inte.
    expect(createTable.match(/\breferences\b/g)).toHaveLength(2);
    expect(code).not.toMatch(/\balter table (public\.)?(users|groups)\b/i);
  });

  it('updated_by is nullable and references users with on delete set null', () => {
    // Spårbarhet, inte behörighet: en raderad admin ska varken ta gruppens inställningar med sig (cascade) eller blockera
    // raderingen av kontot (no action/restrict). Därför nullable + set null.
    expect(createTable).toMatch(/\bupdated_by uuid references public\.users\(id\) on delete set null\b/);
    expect(createTable).not.toMatch(/updated_by uuid not null/);
    expect(createTable).not.toMatch(/updated_by [^,]*on delete (cascade|restrict|no action)/);
  });

  it('key has length check 1-80 and value is jsonb not null', () => {
    expect(createTable).toContain('key text not null check (char_length(key) between 1 and 80)');
    expect(createTable).toContain('value jsonb not null');

    // Samma gränser som user_settings; gruppnycklar i registret (när de finns) måste rymmas.
    const bounds = createTable.match(/char_length\(key\) between (\d+) and (\d+)/);
    expect(bounds).not.toBeNull();
    const [min, max] = [Number(bounds![1]), Number(bounds![2])];
    for (const def of SETTING_DEFINITIONS.filter((d) => d.scope === 'group')) {
      expect(def.key.length, def.key).toBeGreaterThanOrEqual(min);
      expect(def.key.length, def.key).toBeLessThanOrEqual(max);
    }
  });

  it('has RLS on, no policies, and revokes anon and authenticated', () => {
    expect(statements).toContain('alter table public.group_settings enable row level security');
    expect(statements).toContain(revoke);
    // Inga policyer = ingen åtkomst utom service role; inga grants som öppnar tabellen igen.
    expect(code).not.toMatch(/\bcreate policy\b|\balter policy\b/i);
    expect(code).not.toMatch(/\bgrant\b/i);
    expect(code).not.toMatch(/\bdisable row level security\b|\bno force row level security\b/i);
    // Revoke kommer efter create table, annars finns inget att dra in rättigheter från.
    expect(statements.indexOf(revoke)).toBeGreaterThan(statements.findIndex((s) => s.startsWith('create table')));
  });

  it('is additive, idempotent and independent of group_members', () => {
    expect(createTable).toMatch(/^create table if not exists\b/);
    // "on delete cascade/set null" i FK:erna är tillåtet; det som inte får finnas är satser som tar bort eller ändrar data eller schema.
    expect(code).not.toMatch(/\b(drop|rename|truncate|delete from|insert|update)\b/i);
    expect(code).not.toMatch(/\bdelete\b(?!\s+(cascade|set null))/i);
    expect(code).not.toMatch(/\balter table\b[^;]*\b(alter column|drop column|add column)\b/i);
    // Ingen egen transaktionsstyrning: apply_migration kör filen som en transaktion.
    expect(code).not.toMatch(/\b(begin|commit|rollback)\b/i);
    // Lås: set local gäller bara transaktionen och kommer före den första sats som tar lås (FK mot groups och users).
    expect(statements[0]).toBe("set local lock_timeout = '5s'");
    expect(code).not.toMatch(/\bset\s+(session\s+)?lock_timeout\b/i);
    // 053 (group_members) är en annan story; roll prövas i koden, så migrationen får inte bero på den.
    expect(code).not.toMatch(/group_members/i);
  });

  it('header has a commented rollback that drops only group_settings', () => {
    const rollback = sql.split('\n').filter((l) => /^--\s+drop\b/i.test(l)).map((l) => normalize(l.replace(/^--\s*/, '')));
    expect(rollback).toEqual(['drop table if exists public.group_settings;']);
  });
});
