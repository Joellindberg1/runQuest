/**
 * Statiskt test: migration 057 skapar recalculation_marks och de två funktionerna mark_recalculation och clear_recalculation_mark
 * (en beständig markering "användaren behöver omräkning från datum X", RUN-322). Läser SQL-filen från disk, ingen databas.
 *
 * Varför beteendet bara läses och inte körs här: upsert med least(), versionsjämförelsen i clear, cascade och RLS finns bara i Postgres.
 * Testerna fäster därför det som gör beteendet: primärnyckeln (en rad per användare), least(from_date) och version + 1 i upserten,
 * villkoret på versionen i raderingen, RLS på utan policyer, revoke och execute bara för service_role. Beviset i en riktig databas är
 * PGlite-körningen vid leveransen och katalogfrågorna i migrationens header, som Lead kör efter apply.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, '../../../migrations');
const file = '057_create_recalculation_marks.sql';
const sql = readFileSync(resolve(migrationsDir, file), 'utf8');

// Kommentarer bort så att rollback-SQL:en och katalogfrågorna i headern inte räknas som körbar kod.
const code = sql.replace(/--.*$/gm, '');
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
// Satserna på toppnivå: funktionskropparna och efterkontrollen ($function$ ... $function$, $postcheck$ ... $postcheck$) räknas som en sats vardera.
const topLevel = code.replace(/\$(function|postcheck)\$[\s\S]*?\$\1\$/g, '$$$1$$..$$$1$$');
const statements = topLevel.split(';').map(normalize).filter(Boolean);
const createTable = statements.find((s) => s.startsWith('create table')) ?? '';
const normalizedCode = normalize(code);

const fnBody = (name: string): string => {
  const match = code.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$;`, 'i'));
  return normalize(match?.[0] ?? '');
};

describe(`migration ${file}`, () => {
  it('creates recalculation_marks with one row per user: user_id is the primary key and cascades from users', () => {
    expect(createTable).toMatch(/^create table if not exists public\.recalculation_marks \(/);
    expect(createTable).toContain('user_id uuid primary key references public.users(id) on delete cascade');
    // users är den enda tabell som pekas på.
    expect(createTable.match(/\breferences\b/g)).toHaveLength(1);
  });

  it('has the date, a version from a sequence and a timestamp, all not null', () => {
    expect(createTable).toContain('from_date date not null');
    expect(createTable).toContain("version bigint not null default nextval('public.recalculation_mark_version_seq')");
    expect(createTable).not.toMatch(/version bigint not null default \d/);
    expect(createTable).toContain('marked_at timestamptz not null default now()');
  });

  it('has RLS on, no policies, and revokes anon and authenticated', () => {
    expect(statements).toContain('alter table public.recalculation_marks enable row level security');
    expect(statements).toContain('revoke all on public.recalculation_marks from anon, authenticated');
    expect(code).not.toMatch(/\bcreate policy\b|\balter policy\b/i);
    expect(code).not.toMatch(/\bdisable row level security\b|\bno force row level security\b/i);
    expect(normalizedCode).not.toMatch(/grant (all|select|insert|update|delete)\b[^;]* on (table )?public\.recalculation_marks/);
    expect(normalizedCode.indexOf('revoke all on public.recalculation_marks')).toBeGreaterThan(normalizedCode.indexOf('create table'));
  });

  it('the version sequence is created before the table, usable by service_role only, and proven by the postcheck', () => {
    expect(statements).toContain('create sequence if not exists public.recalculation_mark_version_seq');
    expect(statements.indexOf('create sequence if not exists public.recalculation_mark_version_seq')).toBeLessThan(statements.findIndex((s) => s.startsWith('create table')));
    expect(statements).toContain('revoke all on sequence public.recalculation_mark_version_seq from public, anon, authenticated');
    expect(statements).toContain('grant usage on sequence public.recalculation_mark_version_seq to service_role');
    expect(normalizedCode).not.toMatch(/grant [^;]* on sequence [^;]* to [^;]*\b(anon|authenticated|public)\b/);
    const postcheck = normalize(code.match(/do \$postcheck\$[\s\S]*?\$postcheck\$;/i)?.[0] ?? '');
    expect(postcheck).toContain("has_sequence_privilege('anon'");
    expect(postcheck).toContain("has_sequence_privilege('authenticated'");
    expect(postcheck).toContain("has_sequence_privilege('service_role'");
  });

  it('mark_recalculation is an idempotent upsert that keeps the earliest date and takes a new version from the sequence on both paths', () => {
    const body = fnBody('mark_recalculation');
    expect(body).toContain('create or replace function public.mark_recalculation(p_user_id uuid, p_from_date date) returns bigint');
    expect(body).toContain('on conflict (user_id) do update');
    expect(body).toContain('from_date = least(m.from_date, excluded.from_date)');
    // Insert och update tar var sitt nextval: en version som räknas om från raden (m.version + 1) börjar om när raden rensats (ABA).
    expect(body).toContain("values (p_user_id, p_from_date, nextval('public.recalculation_mark_version_seq'))");
    expect(body).toContain("version = nextval('public.recalculation_mark_version_seq')");
    expect(body).not.toMatch(/m\.version \+ 1/);
    expect(body).toContain('returning m.version into v_version');
    expect(body).toContain('return v_version');
    // Ett NULL-argument är ett fel, inte en markering utan datum.
    expect(body).toContain('if p_user_id is null or p_from_date is null then');
    expect(body).toContain("errcode = '22004'");
  });

  it('clear_recalculation_mark deletes only the row with the caller\'s version and says whether it did', () => {
    const body = fnBody('clear_recalculation_mark');
    expect(body).toContain('create or replace function public.clear_recalculation_mark(p_user_id uuid, p_version bigint) returns boolean');
    expect(body).toContain('delete from public.recalculation_marks where user_id = p_user_id and version = p_version');
    expect(body).toContain('return found');
    // Ingen väg till en radering på bara användaren: det är versionsvillkoret som skyddar en nyare markering.
    expect(body.match(/delete from/g)).toHaveLength(1);
  });

  it('both functions are invoker, plpgsql with an empty search_path, executable by service_role only', () => {
    for (const name of ['mark_recalculation', 'clear_recalculation_mark']) {
      const body = fnBody(name);
      expect(body, name).toContain('language plpgsql');
      expect(body, name).toContain("set search_path to ''");
      expect(body, name).not.toMatch(/security definer/);
    }
    for (const signature of ['public.mark_recalculation(uuid, date)', 'public.clear_recalculation_mark(uuid, bigint)']) {
      expect(statements).toContain(`revoke execute on function ${signature} from public, anon, authenticated`);
      expect(statements).toContain(`grant execute on function ${signature} to service_role`);
    }
    expect(normalizedCode).not.toMatch(/grant execute on function [^;]* to [^;]*\b(anon|authenticated|public)\b/);
  });

  it('is additive and idempotent: nothing is dropped, renamed, emptied or written, and no other table is touched', () => {
    expect(createTable).toMatch(/^create table if not exists\b/);
    expect(code).not.toMatch(/\b(drop|rename|truncate)\b/i);
    expect(code).not.toMatch(/\balter table\b(?! public\.recalculation_marks enable row level security)/i);
    // update och insert finns bara i mark_recalculation (upserten) och delete bara i clear_recalculation_mark, ingen rad rörs vid apply.
    expect(topLevel).not.toMatch(/\b(insert|update|delete from)\b/i);
    expect(code).not.toMatch(/\b(begin|commit|rollback)\s*;/i);
    expect(code).not.toMatch(/\bgroup_members\b|\bgroup_settings\b/i);
  });

  it('sets a local lock timeout first, so the migration fails instead of queuing write traffic behind the lock on users', () => {
    expect(statements[0]).toBe("set local lock_timeout = '5s'");
    expect(code).not.toMatch(/\bset\s+(session\s+)?lock_timeout\b/i);
  });

  it('proves the grants and RLS in the same transaction with a postcheck that raises on a problem', () => {
    const postcheck = normalize(code.match(/do \$postcheck\$[\s\S]*?\$postcheck\$;/i)?.[0] ?? '');
    expect(postcheck).toContain('relrowsecurity');
    expect(postcheck).toContain("has_table_privilege('anon'");
    expect(postcheck).toContain("has_function_privilege('anon'");
    expect(postcheck).toContain("has_function_privilege('authenticated'");
    expect(postcheck).toContain("has_function_privilege('service_role'");
    expect(postcheck).toContain('a.grantee = 0'); // PUBLIC i ACL:en
    expect(postcheck).toContain('raise exception');
  });

  it('header has a commented rollback that drops the two functions, the table and the sequence, in that order, and nothing else', () => {
    const rollback = sql
      .split('\n')
      .filter((l) => /^--\s+drop\b/i.test(l))
      .map((l) => normalize(l.replace(/^--\s*/, '')));
    expect(rollback).toEqual([
      'drop function if exists public.clear_recalculation_mark(uuid, bigint);',
      'drop function if exists public.mark_recalculation(uuid, date);',
      'drop table if exists public.recalculation_marks;',
      'drop sequence if exists public.recalculation_mark_version_seq;',
    ]);
  });
});
