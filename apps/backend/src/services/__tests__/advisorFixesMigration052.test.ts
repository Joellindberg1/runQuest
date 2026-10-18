/**
 * Statiskt test: migration 052 (Supabase-säkerhetsråd). Läser SQL-filerna från disk, ingen databas.
 *  - increment_event_xp får fast search_path men behåller signatur, returtyp, språk, säkerhetsläge och beteende från baslinjen.
 *  - Det döda cron-jobbet avregistreras utan hårdkodat jobid, bakom en guard, och pg_net tas bort bara efter kontroller.
 *  - title_leaderboard_view får security_invoker utan att någon behörighet ändras.
 *  - Ingen JWT eller nyckel i filen, rollback finns och återskapar inte jobbet.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, '../../../migrations');
const sql = readFileSync(resolve(migrationsDir, '052_advisor_fixes.sql'), 'utf8');
const baseline = readFileSync(resolve(migrationsDir, '000_baseline.sql'), 'utf8');

// Kommentarer bort så att rollback-SQL:en i headern inte räknas som körbar kod.
const code = sql.replace(/--.*$/gm, '');
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const body = normalize(code);

const baselineFunction = /create or replace function public\.increment_event_xp[\s\S]*?\$function\$;/i.exec(baseline.slice(baseline.search(/create or replace function public\.increment_event_xp/i)));
const migrationFunction = /create or replace function public\.increment_event_xp[\s\S]*?\$function\$;/i.exec(code);

/** Rollback-raderna i headern (kommentarer som börjar med `--` följt av minst fyra blanksteg), utan kommentarstecknen. */
const rollbackSql = sql
  .split(/\r?\n/)
  .filter((line) => /^--\s{4,}\S/.test(line))
  .map((line) => line.replace(/^--\s*/, ''))
  .join('\n');

describe('migration 052_advisor_fixes.sql: increment_event_xp', () => {
  it('sätter search_path till tom sträng och kvalificerar tabellen', () => {
    expect(migrationFunction).not.toBeNull();
    const fn = normalize(migrationFunction![0]);
    expect(fn).toContain("set search_path to ''");
    expect(fn).toContain('update public.users');
    expect(fn).not.toMatch(/update users/);
  });

  it('behåller signatur, returtyp, språk och säkerhetsläge från baslinjen och är inte security definer', () => {
    expect(baselineFunction).not.toBeNull();
    const head = (s: string) => normalize(s.slice(0, s.search(/\bas\b\s+\$function\$/i)));
    const baseHead = head(baselineFunction![0]);
    const newHead = head(migrationFunction![0]).replace(" set search_path to ''", '');
    expect(newHead).toBe(baseHead);
    expect(baseHead).toContain('(p_user_id uuid, p_xp integer)');
    expect(baseHead).toContain('returns void');
    expect(baseHead).toContain('language sql');
    expect(normalize(migrationFunction![0])).not.toContain('security definer');
  });

  it('har samma kropp som baslinjen förutom att users är kvalificerad (event_xp och total_xp ökar med p_xp)', () => {
    const inner = (s: string) => normalize(s.slice(s.search(/\$function\$/i)));
    expect(inner(migrationFunction![0])).toBe(inner(baselineFunction![0]).replace('update users', 'update public.users'));
  });

  it('ändrar inga behörigheter: inga grant, revoke eller owner', () => {
    expect(code).not.toMatch(/\b(grant|revoke|owner\s+to)\b/i);
  });
});

describe('migration 052_advisor_fixes.sql: cron-jobbet och pg_net', () => {
  it('avregistrerar jobbet via sin url, inte med ett hårdkodat jobid, bakom en guard för att cron saknas', () => {
    expect(body).toContain("to_regclass('cron.job') is not null");
    expect(body).toContain("where command ilike '%functions/v1/strava-sync%'");
    expect(body).toContain('perform cron.unschedule(j.jobid)');
    expect(code).not.toMatch(/cron\.unschedule\s*\(\s*[0-9']/);
    expect(code).not.toMatch(/jobid\s*=\s*[0-9]/i);
    // Allt som rör cron-schemat ligger inne i guarden, före den första cron-referensen.
    expect(body.indexOf("to_regclass('cron.job')")).toBeLessThan(body.indexOf('from cron.job'));
    expect(body.indexOf('from cron.job')).toBeLessThan(body.indexOf('perform cron.unschedule'));
  });

  it('skriver aldrig ut jobbets command (det innehåller JWT:n)', () => {
    const notices = code.match(/raise notice[^;]*;/gi) ?? [];
    expect(notices.length).toBeGreaterThan(0);
    for (const notice of notices) expect(notice).not.toMatch(/command/i);
    expect(code).not.toMatch(/select[^;]*\bcommand\b[^;]*from cron\.job/i);
  });

  it('tar bort pg_net med drop extension if exists, utan cascade, först efter kontrollerna', () => {
    expect(code.match(/drop\s+extension/gi)).toHaveLength(1);
    expect(body).toContain('drop extension if exists pg_net;');
    expect(body).not.toMatch(/drop extension[^;]*cascade/);
    const dropAt = body.indexOf('drop extension');
    expect(body.indexOf("command ~* 'net\\.http_'")).toBeGreaterThan(-1);
    expect(body.indexOf("command ~* 'net\\.http_'")).toBeLessThan(dropAt);
    expect(body.indexOf("p.prosrc ~* 'net\\.http_'")).toBeGreaterThan(-1);
    expect(body.indexOf("p.prosrc ~* 'net\\.http_'")).toBeLessThan(dropAt);
    expect(code.match(/raise exception/gi)).toHaveLength(2);
  });

  it('lämnar pg_cron kvar', () => {
    expect(code).not.toMatch(/drop\s+extension[^;]*pg_cron/i);
    expect(code).not.toMatch(/cron\.schedule/i);
  });

  it('lägger cron-avregistreringen och pg_net-borttagningen i samma do-block så att ett guard-fel avbryter allt', () => {
    expect(code.match(/\bdo\s+\$\$/gi)).toHaveLength(1);
    const doAt = body.indexOf('do $$');
    expect(body.indexOf('perform cron.unschedule')).toBeGreaterThan(doAt);
    expect(body.indexOf('drop extension')).toBeGreaterThan(doAt);
    expect(body.endsWith('end $$;')).toBe(true);
  });
});

describe('migration 052_advisor_fixes.sql: title_leaderboard_view', () => {
  it('sätter security_invoker = true med alter view och rör inga behörigheter eller vydefinitionen', () => {
    expect(body).toContain('alter view public.title_leaderboard_view set (security_invoker = true);');
    expect(code).not.toMatch(/create\s+(or\s+replace\s+)?view/i);
    expect(code).not.toMatch(/\b(grant|revoke)\b/i);
  });
});

describe('migration 052_advisor_fixes.sql: säkerhet och form', () => {
  it('innehåller ingen JWT, nyckel eller projektadress', () => {
    expect(sql).not.toMatch(/eyJ[A-Za-z0-9_-]{8,}/);
    expect(sql).not.toMatch(/\b(sbp_|sb_secret_|sb_publishable_|sk_live_)\w/i);
    expect(sql).not.toMatch(/service_role_key|apikey|bearer/i);
    expect(sql).not.toMatch(/\.supabase\.co/i);
    expect(sql).not.toMatch(/https?:\/\//i);
  });

  it('raderar och ändrar ingen data', () => {
    expect(code).not.toMatch(/\b(delete\s+from|truncate|insert\s+into|drop\s+table)\b/i);
    // update förekommer bara i funktionskroppen.
    expect(code.match(/\bupdate\b/gi)).toHaveLength(1);
  });

  it('är idempotent: bara create or replace, alter view set, och ett do-block med guards', () => {
    const outsideDo = code.replace(/do\s+\$\$[\s\S]*?\$\$;/i, '').replace(/\$function\$[\s\S]*?\$function\$/i, '');
    const statements = outsideDo.split(';').map(normalize).filter(Boolean);
    expect(statements).toEqual([
      "create or replace function public.increment_event_xp(p_user_id uuid, p_xp integer) returns void language sql set search_path to '' as",
      'alter view public.title_leaderboard_view set (security_invoker = true)',
    ]);
  });

  it('headern har rollback som återskapar funktionen exakt som i baslinjen, vyn utan alternativ och pg_net i schemat extensions', () => {
    const fnRollback = /create or replace function public\.increment_event_xp[\s\S]*?\$function\$;/i.exec(rollbackSql);
    expect(fnRollback, 'rollback för funktionen saknas').not.toBeNull();
    expect(normalize(fnRollback![0])).toBe(normalize(baselineFunction![0]));
    expect(normalize(rollbackSql)).toContain('alter view public.title_leaderboard_view reset (security_invoker);');
    expect(normalize(rollbackSql)).toContain('create extension if not exists pg_net with schema extensions;');
  });

  it('headern säger att cron-jobbet inte återskapas och att inga hemligheter skrivs in igen', () => {
    expect(sql).toMatch(/Cron-jobbet återskapas INTE/);
    expect(sql).toMatch(/hemligheter hör inte hemma i migrationer/);
    expect(rollbackSql).not.toMatch(/cron\.schedule/i);
  });

  it('headern anger syfte, före-läge, körordning, idempotens, ägar-ja per miljö och kontrollfrågor', () => {
    for (const heading of ['SYFTE', 'FÖRE-LÄGE', 'BESLUT PER PUNKT', 'KÖRORDNING', 'IDEMPOTENS', 'KONTROLLFRÅGOR', 'ROLLBACK']) {
      expect(sql, heading).toContain(heading);
    }
    expect(sql).toMatch(/ägar-ja per miljö/i);
    expect(sql).toMatch(/aldrig av en builder/);
    expect(sql).toMatch(/jobid 1/);
    expect(sql).toMatch(/2025-06-11/);
  });
});
