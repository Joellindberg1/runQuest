/**
 * Statiskt test: migration 053 skapar group_members, join_group, create_group_with_admin och backfyller medlemskap (ADR 012 beslut 2 och 3).
 * Läser SQL-filen från disk, ingen databas.
 *
 * Varför beteendet bara läses och inte körs här: unika partiella index, FOR UPDATE, DO-block och RLS finns bara i Postgres, och prod
 * (och staging) är förbjudet för en builder. Testerna fäster därför det som gör beteendet: tabellens kolumner och CHECK, de tre indexen,
 * RLS utan policyer, funktionssignaturerna och behörigheterna, förkontrollens tre stopp och att den kommer före backfillen, och att
 * backfillen bara skriver starts_on null. Beviset i en riktig databas är katalogfrågorna i migrationens header, som Lead kör i staging.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, '../../../migrations');
const file = '053_create_group_members.sql';
const sql = readFileSync(resolve(migrationsDir, file), 'utf8');

// Kommentarer bort så att rollback-SQL:en och bevisfrågorna i headern inte räknas som körbar kod.
const code = sql.replace(/--.*$/gm, '');
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim();

// Funktions- och DO-block innehåller semikolon, så de tas ut som enheter och resten delas i satser.
const extract = (re: RegExp): string => code.match(re)?.[0] ?? '';
const joinFn = extract(/create or replace function public\.join_group\([^)]*\)[\s\S]*?\$function\$;/i);
const createFn = extract(/create or replace function public\.create_group_with_admin\([^)]*\)[\s\S]*?\$function\$;/i);
const preflight = extract(/do \$preflight\$[\s\S]*?\$preflight\$;/i);
const postcheck = extract(/do \$postcheck\$[\s\S]*?\$postcheck\$;/i);
const statements = [joinFn, createFn, preflight, postcheck]
  .reduce((rest, block) => (block ? rest.replace(block, ' ') : rest), code)
  .split(';')
  .map(normalize)
  .filter(Boolean);
const createTable = statements.find((s) => s.startsWith('create table')) ?? '';
const backfill = statements.find((s) => s.startsWith('insert into public.group_members')) ?? '';

const body = (fn: string) => normalize(fn.slice(fn.search(/\bbegin\b/i)));
const joinBody = body(joinFn);
const createBody = body(createFn);
const preflightBody = normalize(preflight);
const at = (haystack: string, re: RegExp) => haystack.search(re);

describe(`migration ${file}`, () => {
  it('skapar group_members med kolumnerna, rollistan och främmande nycklar med on delete cascade', () => {
    expect(createTable).toMatch(/^create table if not exists public\.group_members \(/);
    expect(createTable).toContain('id uuid primary key default gen_random_uuid()');
    expect(createTable).toContain('group_id uuid not null references public.groups(id) on delete cascade');
    expect(createTable).toContain('user_id uuid not null references public.users(id) on delete cascade');
    expect(createTable).toContain("role text not null default 'member' check (role in ('admin','member'))");
    expect(createTable).toContain('starts_on date,');
    expect(createTable).toContain('joined_at timestamptz not null default now()');
    expect(createTable).toMatch(/left_at timestamptz\s*\)$/);
    // starts_on och left_at är nullbara (null = hela historiken resp. aktivt), alltså utan not null.
    expect(createTable).not.toMatch(/starts_on date not null|left_at timestamptz not null/);
    expect(createTable.match(/\breferences\b/g)).toHaveLength(2);
  });

  it('har index: ett aktivt medlemskap per användare, en admin per grupp och gruppens aktiva medlemmar', () => {
    expect(statements).toContain(
      'create unique index if not exists group_members_one_active_per_user on public.group_members (user_id) where left_at is null',
    );
    expect(statements).toContain(
      "create unique index if not exists group_members_one_admin_per_group on public.group_members (group_id) where left_at is null and role = 'admin'",
    );
    expect(statements).toContain(
      'create index if not exists group_members_group_active on public.group_members (group_id) where left_at is null',
    );
    expect(code).not.toMatch(/\bconcurrently\b/i); // kan inte köras i apply_migrations transaktion
  });

  it('RLS är på, inga policyer finns och anon och authenticated har revoke', () => {
    expect(statements).toContain('alter table public.group_members enable row level security');
    expect(statements).toContain('revoke all on public.group_members from anon, authenticated');
    expect(code).not.toMatch(/\bcreate policy\b|\balter policy\b/i);
    expect(code).not.toMatch(/\bgrant\b[^;]*\bgroup_members\b/i);
    expect(code).not.toMatch(/\bdisable row level security\b|\bno force row level security\b/i);
    expect(statements.indexOf('revoke all on public.group_members from anon, authenticated')).toBeGreaterThan(
      statements.findIndex((s) => s.startsWith('create table')),
    );
  });

  it('join_group och create_group_with_admin har rätt signaturer och returtyper och fast search_path', () => {
    expect(normalize(joinFn)).toMatch(
      /^create or replace function public\.join_group\(p_user_id uuid, p_group_id uuid, p_role text, p_today date\) returns public\.group_members language plpgsql set search_path to ''/,
    );
    expect(normalize(createFn)).toMatch(
      /^create or replace function public\.create_group_with_admin\(p_name text, p_invite_code text, p_owner_id uuid, p_today date\) returns public\.groups language plpgsql set search_path to ''/,
    );
    // Båda körs av service_role (som kringgår RLS) som anroparen; ingen definer som kunde höja rättigheterna om en grant glider.
    expect(code).not.toMatch(/\bsecurity\s+definer\b/i);
  });

  it('funktionerna kan bara köras av service_role (execute indraget från public, anon och authenticated)', () => {
    expect(statements).toContain(
      'revoke execute on function public.join_group(uuid, uuid, text, date) from public, anon, authenticated',
    );
    expect(statements).toContain(
      'revoke execute on function public.create_group_with_admin(text, text, uuid, date) from public, anon, authenticated',
    );
    expect(statements.filter((s) => s.startsWith('grant '))).toEqual([
      'grant execute on function public.join_group(uuid, uuid, text, date) to service_role',
      'grant execute on function public.create_group_with_admin(text, text, uuid, date) to service_role',
    ]);
  });

  it('funktionerna använder bara schemakvalificerade tabeller, eftersom search_path är tom', () => {
    for (const fnBody of [joinBody, createBody, preflightBody]) {
      const relations = [...fnBody.matchAll(/\b(?:from|(?<!for )update|join|into)\s+([a-z_][a-z0-9_.]*)/g)]
        .map((m) => m[1])
        // plpgsql-variabler efter "into" (v_*) och "for r in select ... from" aliasen räknas inte som tabeller.
        .filter((name) => !name.startsWith('v_'));
      expect(relations.length).toBeGreaterThan(0);
      for (const relation of relations) {
        expect(['public.users', 'public.groups', 'public.group_members']).toContain(relation);
      }
    }
  });
});

describe('join_group (ADR 012 beslut 2.2 och 2.3)', () => {
  it('låser användarraden först, så att samtidiga join-anrop för samma användare serialiseras', () => {
    expect(joinBody).toMatch(/perform 1 from public\.users where id = p_user_id for update;/);
    expect(at(joinBody, /for update/)).toBeLessThan(at(joinBody, /insert into public\.group_members/));
  });

  it('kräver att användaren inte har ett aktivt medlemskap (23505, already_member), annars ingen rad', () => {
    expect(joinBody).toMatch(
      /if exists \(select 1 from public\.group_members where user_id = p_user_id and left_at is null\) then raise exception 'join_group: already_member' using errcode = '23505';/,
    );
    expect(at(joinBody, /already_member/)).toBeLessThan(at(joinBody, /insert into public\.group_members/));
  });

  it('avvisar okänd användare och grupp, ogiltig roll och en andra admin med tydliga fel', () => {
    expect(joinBody).toMatch(/raise exception 'join_group: user_not_found' using errcode = 'p0002'/);
    expect(joinBody).toMatch(/raise exception 'join_group: group_not_found' using errcode = 'p0002'/);
    expect(joinBody).toMatch(/p_role is null or p_role not in \('admin', 'member'\) then raise exception 'join_group: invalid_role' using errcode = '22023'/);
    expect(joinBody).toMatch(/raise exception 'join_group: group_has_admin' using errcode = '23505'/);
  });

  it('starts_on blir null för första medlemskapet och p_today för varje senare; p_today saknas ger fel i stället för null', () => {
    expect(joinBody).toMatch(/v_had_membership := exists \(select 1 from public\.group_members where user_id = p_user_id\);/);
    expect(joinBody).toMatch(/if v_had_membership and p_today is null then raise exception 'join_group: today_required' using errcode = '22004';/);
    expect(joinBody).toMatch(/case when v_had_membership then p_today else null end/);
    // Dagen kommer från appen (Stockholm-datum, calendar.ts), aldrig från databasens klocka eller tidszon.
    for (const fnBody of [joinBody, createBody]) {
      expect(fnBody).not.toMatch(/current_date|current_timestamp|localtimestamp|now\(\)::date|timezone\(|at time zone/);
    }
  });

  it('sätter users.group_id i samma funktion som infogar raden, och returnerar medlemskapsraden', () => {
    expect(joinBody).toMatch(/update public\.users set group_id = p_group_id where id = p_user_id;/);
    expect(at(joinBody, /insert into public\.group_members/)).toBeLessThan(at(joinBody, /update public\.users set group_id/));
    expect(joinBody).toMatch(/returning \* into v_row;/);
    expect(joinBody).toMatch(/return v_row;/);
  });
});

describe('create_group_with_admin (ADR 012 beslut 2.2)', () => {
  it('kräver namn, inbjudningskod och ägare och avvisar okänd ägare', () => {
    expect(createBody).toMatch(/p_name is null or btrim\(p_name\) = '' then raise exception 'create_group_with_admin: name_required' using errcode = '22023'/);
    expect(createBody).toMatch(/p_invite_code is null or btrim\(p_invite_code\) = '' then raise exception 'create_group_with_admin: invite_code_required' using errcode = '22023'/);
    expect(createBody).toMatch(/p_owner_id is null then raise exception 'create_group_with_admin: owner_required' using errcode = '22004'/);
    expect(createBody).toMatch(/perform 1 from public\.users where id = p_owner_id for update;/);
    expect(createBody).toMatch(/raise exception 'create_group_with_admin: owner_not_found' using errcode = 'p0002'/);
  });

  it('skapar gruppen med owner_id och ger skaparen rollen admin via join_group (som sätter pekaren)', () => {
    expect(createBody).toMatch(/insert into public\.groups \(name, invite_code, owner_id\) values \(p_name, p_invite_code, p_owner_id\) returning \* into v_group;/);
    expect(createBody).toMatch(/perform public\.join_group\(p_owner_id, v_group\.id, 'admin', p_today\);/);
    expect(at(createBody, /insert into public\.groups/)).toBeLessThan(at(createBody, /perform public\.join_group/));
    expect(createBody).toMatch(/return v_group;/);
    // Pekaren users.group_id skrivs på ett ställe i hela filen: join_group.
    expect([...code.matchAll(/update\s+public\.users\s+set\s+group_id/gi)]).toHaveLength(1);
    expect(joinBody).toMatch(/update public\.users set group_id/);
  });
});

describe('förkontroll och backfill (ADR 012 beslut 3, N5)', () => {
  it('förkontrollen stoppar migrationen vid flera grupper, grupplösa användare eller oklar admin', () => {
    expect(preflight).not.toBe('');
    expect(preflightBody).toMatch(/raise exception 'migration 053 stopped: % groups have members, expected exactly 1/);
    expect(preflightBody).toMatch(/raise exception 'migration 053 stopped: % users have no group/);
    expect(preflightBody).toMatch(/raise exception 'migration 053 stopped: group % has no unambiguous admin/);
    // Räknar bara användare med grupp resp. utan grupp, och väljer admin på ägaren först, annars den enda is_admin i gruppen.
    expect(preflightBody).toMatch(/count\(distinct group_id\) into v_groups from public\.users where group_id is not null/);
    expect(preflightBody).toMatch(/count\(\*\) into v_ungrouped from public\.users where group_id is null/);
    expect(preflightBody).toMatch(/o\.id = g\.owner_id and o\.group_id = g\.id/);
    expect(preflightBody).toMatch(/coalesce\(a\.is_admin, false\)/);
    // Stoppen gäller första körningen (tom group_members); en omkörning efter att fler grupper eller ett supportkonto tillkommit fäller inte.
    expect(preflightBody).toMatch(/v_first_run := not exists \(select 1 from public\.group_members\);/);
  });

  it('förkontrollen raderar eller ändrar ingenting och stoppar före backfillen', () => {
    expect(preflightBody).not.toMatch(/\b(insert|update|delete|truncate|drop)\b/);
    expect(code.search(/do \$preflight\$/i)).toBeLessThan(code.search(/insert into public\.group_members/i));
    expect(code.search(/do \$preflight\$/i)).toBeGreaterThan(code.search(/create table if not exists public\.group_members/i));
  });

  it('backfill: en aktiv rad per användare med grupp, starts_on null och admin bara på gruppens ägare eller enda is_admin', () => {
    expect(backfill).not.toBe('');
    expect(backfill).toMatch(/^insert into public\.group_members \(group_id, user_id, role, starts_on\) /);
    // Alla backfyllda rader har starts_on null (hela historiken), aldrig ett datum.
    expect(backfill).toMatch(/\bnull::date\b/);
    expect(backfill).not.toMatch(/current_date|now\(\)|joined_at/);
    expect(backfill).toMatch(/where u\.group_id is not null and not exists \(select 1 from public\.group_members m where m\.user_id = u\.id and m\.left_at is null\)$/);
    expect(backfill).toMatch(/case when ap\.admin_id = u\.id then 'admin' else 'member' end/);
    // Ägaren gäller bara om den är medlem i gruppen; annars den enda is_admin-användaren i gruppen.
    expect(backfill).toMatch(/\(select o\.id from public\.users o where o\.id = g\.owner_id and o\.group_id = g\.id\)/);
    expect(backfill).toMatch(/\(select \(array_agg\(a\.id order by a\.id\)\)\[1\] from public\.users a where a\.group_id = g\.id and coalesce\(a\.is_admin, false\)\)/);
    // Grupper som redan har en aktiv admin får inget admin_pick, så en omkörning lägger bara till medlemmar.
    expect(backfill).toMatch(/not exists \(select 1 from public\.group_members m where m\.group_id = g\.id and m\.role = 'admin' and m\.left_at is null\)/);
  });

  it('slutkontroll i migrationen: varje användare med grupp har ett aktivt medlemskap i samma grupp och varje grupp med medlemmar exakt en admin', () => {
    const check = normalize(postcheck);
    expect(check).toMatch(/raise exception 'migration 053 failed: % users have no active membership in their group/);
    expect(check).toMatch(/m\.group_id = u\.group_id/);
    expect(check).toMatch(/raise exception 'migration 053 failed: % groups with members have no active admin/);
    expect(code.search(/do \$postcheck\$/i)).toBeGreaterThan(code.search(/insert into public\.group_members/i));
  });

  it('migrationen skapar ingen trigger och rör inte users, groups, user_titles eller title_leaderboard i schemat', () => {
    expect(code).not.toMatch(/\bcreate\s+(or\s+replace\s+)?trigger\b/i);
    expect(code).not.toMatch(/\balter table (public\.)?(users|groups|user_titles|title_leaderboard)\b/i);
    expect(code).not.toMatch(/\b(user_titles|title_leaderboard)\b/i);
  });
});

describe(`migration ${file}: form och rollback`, () => {
  it('är additiv och idempotent: if not exists, inga drop, rename, truncate eller delete, ingen egen transaktion', () => {
    expect(createTable).toMatch(/^create table if not exists\b/);
    expect(code).not.toMatch(/\b(drop|rename|truncate|delete from)\b/i);
    expect(code).not.toMatch(/\bdelete\b(?!\s+cascade)/i);
    expect(code).not.toMatch(/\balter table\b[^;]*\b(alter column|drop column|add column)\b/i);
    expect(code).not.toMatch(/\b(begin;|commit|rollback)\b/i);
    expect(statements[0]).toBe("set local lock_timeout = '5s'");
    expect(code).not.toMatch(/\bset\s+(session\s+)?lock_timeout\b/i);
  });

  it('rollback i huvudet: funktionerna släpps före tabellen och inget annat', () => {
    const rollback = sql
      .split('\n')
      .filter((l) => /^--\s+drop\b/i.test(l))
      .map((l) => normalize(l.replace(/^--\s*/, '')));
    expect(rollback).toEqual([
      'drop function if exists public.create_group_with_admin(text, text, uuid, date);',
      'drop function if exists public.join_group(uuid, uuid, text, date);',
      'drop table if exists public.group_members;',
    ]);
  });
});
