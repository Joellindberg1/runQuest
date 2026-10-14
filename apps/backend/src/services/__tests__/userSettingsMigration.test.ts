/**
 * Statiskt test: migration 048 skapar user_settings, en gles tabell med en rad per (användare, nyckel) (ADR 011 beslut 2, B1).
 * Läser SQL-filen från disk, ingen databas.
 *
 * Varför beteendet bara läses och inte körs här: cascade, CHECK och RLS finns bara i Postgres, och prod är förbjudet i den här
 * leveransen. Testerna fäster därför det som gör beteendet: nyckeln (user_id, key), FK:n med on delete cascade, CHECK-gränserna,
 * RLS på utan policyer och revoke. Beviset i en riktig databas är en fråga mot katalogen efter apply (se migrationens header).
 *
 * Koppling till koden: registret (SETTING_DEFINITIONS i @runquest/shared) har ingen exporterad konstant för nyckellängden,
 * så gränserna läses ur SQL:ens CHECK och varje registernyckel prövas mot dem. Ändras CHECK-satsen eller en nyckel så att de
 * glider isär, fallerar testet i stället för att ett PUT får ett constraint-fel i produktion.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SETTING_DEFINITIONS } from '@runquest/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, '../../../migrations');
const file = '048_create_user_settings.sql';
const sql = readFileSync(resolve(migrationsDir, file), 'utf8');

// Kommentarer bort så att rollback-SQL:en i headern inte räknas som körbar kod.
const code = sql.replace(/--.*$/gm, '');
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const statements = code.split(';').map(normalize).filter(Boolean);
const createTable = statements.find((s) => s.startsWith('create table')) ?? '';

describe(`migration ${file}`, () => {
  it('skapar user_settings med primärnyckel (user_id, key) och on delete cascade mot users', () => {
    expect(createTable).toMatch(/^create table if not exists public\.user_settings \(/);
    expect(createTable).toContain('user_id uuid not null references public.users(id) on delete cascade');
    expect(createTable).toContain('primary key (user_id, key)');
    expect(createTable).toContain('updated_at timestamptz not null default now()');
    // Ingen annan referens: raderas användaren följer raderna med, och inget annat än users pekas på.
    expect(createTable.match(/\breferences\b/g)).toHaveLength(1);
    // users rörs inte (ADR 011 B1: inget nytt i den känsliga tabellen).
    expect(code).not.toMatch(/\balter table (public\.)?users\b/i);
  });

  it('key har längdkontroll 1–80 och value är jsonb not null', () => {
    expect(createTable).toContain('key text not null check (char_length(key) between 1 and 80)');
    expect(createTable).toContain('value jsonb not null');

    // Gränserna ur SQL:en prövas mot de verkliga registernycklarna.
    const bounds = createTable.match(/char_length\(key\) between (\d+) and (\d+)/);
    expect(bounds).not.toBeNull();
    const [min, max] = [Number(bounds![1]), Number(bounds![2])];
    expect(SETTING_DEFINITIONS.length).toBeGreaterThan(0);
    for (const def of SETTING_DEFINITIONS) {
      expect(def.key.length, def.key).toBeGreaterThanOrEqual(min);
      expect(def.key.length, def.key).toBeLessThanOrEqual(max);
    }
  });

  it('RLS är på, inga policyer finns och anon och authenticated har revoke', () => {
    expect(statements).toContain('alter table public.user_settings enable row level security');
    expect(statements).toContain('revoke all on public.user_settings from anon, authenticated');
    // Inga policyer = ingen åtkomst utom service role; inga grants som öppnar tabellen igen.
    expect(code).not.toMatch(/\bcreate policy\b|\balter policy\b/i);
    expect(code).not.toMatch(/\bgrant\b/i);
    expect(code).not.toMatch(/\bdisable row level security\b|\bno force row level security\b/i);
    // Revoke kommer efter create table, annars finns inget att dra in rättigheter från.
    expect(statements.indexOf('revoke all on public.user_settings from anon, authenticated')).toBeGreaterThan(
      statements.findIndex((s) => s.startsWith('create table')),
    );
  });

  it('migrationen är additiv och idempotent (create table if not exists, inga drop, rename, truncate eller delete)', () => {
    expect(createTable).toMatch(/^create table if not exists\b/);
    // "on delete cascade" i FK:n är tillåtet; det som inte får finnas är satser som tar bort eller ändrar data eller schema.
    expect(code).not.toMatch(/\b(drop|rename|truncate|delete from|insert|update)\b/i);
    expect(code).not.toMatch(/\bdelete\b(?!\s+cascade)/i);
    expect(code).not.toMatch(/\balter table\b[^;]*\b(alter column|drop column|add column)\b/i);
    // Ingen egen transaktionsstyrning: apply_migration kör filen som en transaktion.
    expect(code).not.toMatch(/\b(begin|commit|rollback)\b/i);
    // Lås: set local gäller bara transaktionen och kommer före den första sats som tar lås (FK mot users).
    expect(statements[0]).toBe("set local lock_timeout = '5s'");
    expect(code).not.toMatch(/\bset\s+(session\s+)?lock_timeout\b/i);
  });

  it('header has a commented rollback that drops only user_settings', () => {
    const rollback = sql.split('\n').filter((l) => /^--\s+drop\b/i.test(l)).map((l) => normalize(l.replace(/^--\s*/, '')));
    expect(rollback).toEqual(['drop table if exists public.user_settings;']);
  });
});
