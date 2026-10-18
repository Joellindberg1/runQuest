/**
 * Statiskt test: migration 052 (Supabase-säkerhetsråd). Läser SQL-filerna från disk, ingen databas.
 *  - increment_event_xp får fast search_path men behåller signatur, returtyp, språk, säkerhetsläge och beteende från baslinjen.
 *  - Det döda cron-jobbet avregistreras utan hårdkodat jobid, bakom en guard, och bara när exakt ett jobb matchar.
 *  - pg_net tas bara bort när den ligger i public och ingen använder den, och ett misslyckande (ägarskap) avbryter aldrig resten.
 *  - title_leaderboard_view får security_invoker, och senare migrationer som återskapar vyn måste behålla det.
 *  - Ingen JWT eller nyckel i filen, och rollbacken återskapar funktionen exakt som baslinjen.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, '../../../migrations');
const sql = readFileSync(resolve(migrationsDir, '052_advisor_fixes.sql'), 'utf8');
const baseline = readFileSync(resolve(migrationsDir, '000_baseline.sql'), 'utf8');

const stripComments = (s: string) => s.replace(/--.*$/gm, '');
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
// Kommentarer bort så att rollback-SQL:en i headern inte räknas som körbar kod.
const code = stripComments(sql);
const body = normalize(code);
const at = (needle: string, from = 0) => body.indexOf(needle, from);

const FUNCTION_RE = /create or replace function public\.increment_event_xp[\s\S]*?\$function\$;/i;
const baselineFunction = FUNCTION_RE.exec(baseline.slice(baseline.search(/create or replace function public\.increment_event_xp/i)));
const migrationFunction = FUNCTION_RE.exec(code);

/** Rollback-raderna i headern (kommentarer som börjar med `--` följt av minst fyra blanksteg), utan kommentarstecknen. */
const rollbackSql = sql
  .split(/\r?\n/)
  .filter((line) => /^--\s{4,}\S/.test(line))
  .map((line) => line.replace(/^--\s*/, ''))
  .join('\n');

/** Satser som skapar title_leaderboard_view utan security_invoker = true. Kommentarer ignoreras. */
function viewStatementsWithoutInvoker(migrationSql: string): string[] {
  const statements = stripComments(migrationSql).match(/create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?title_leaderboard_view\b[^;]*;/gi) ?? [];
  return statements.filter((statement) => !/\bwith\s*\([^)]*security_invoker\s*=\s*true[^)]*\)/i.test(statement));
}

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

describe('migration 052_advisor_fixes.sql: cron-jobbet', () => {
  it('rör cron-schemat bara bakom to_regclass-guarden, så att staging (utan pg_cron) hoppar över steget', () => {
    expect(body).toContain("to_regclass('cron.job') is not null");
    const firstCron = at('from cron.job');
    expect(at("to_regclass('cron.job') is not null")).toBeLessThan(firstCron);
    expect(at('perform cron.unschedule')).toBeGreaterThan(firstCron);
  });

  it('avregistrerar via url-delen och bara när exakt ett jobb matchar, utan hårdkodat jobid', () => {
    expect(body).toContain("where command ilike '%functions/v1/strava-sync%'");
    expect(body).toContain('perform cron.unschedule(j.jobid)');
    expect(body).toMatch(/if matching_jobs = 1 then[\s\S]*perform cron\.unschedule\(j\.jobid\)[\s\S]*elsif matching_jobs > 1 then/);
    expect(code).not.toMatch(/cron\.unschedule\s*\(\s*[0-9']/);
    expect(code).not.toMatch(/jobid\s*=\s*[0-9]/i);
  });

  it('hoppar över avregistreringen med en NOTICE när fler än ett jobb matchar, och räknar upp antalet synliga jobb', () => {
    const elsif = body.slice(at('elsif matching_jobs > 1 then'));
    expect(elsif.slice(0, elsif.indexOf('end if;'))).toContain('raise notice');
    expect(body).toMatch(/select count\(\*\) into visible_jobs from cron\.job/);
    expect(body).toMatch(/raise notice '[^']*%[^']*', visible_jobs/);
  });

  it('skriver aldrig ut jobbets command (det innehåller JWT:n), bara jobid och jobname', () => {
    const notices = code.match(/raise notice[^;]*;/gi) ?? [];
    expect(notices.length).toBeGreaterThan(0);
    for (const notice of notices) expect(notice).not.toMatch(/\bcommand\b/i);
    expect(code).not.toMatch(/select[^;]*\bcommand\b[^;]*from cron\.job/i);
    expect(code).not.toMatch(/\bj\.command\b/i);
  });

  it('lägger aldrig till ett nytt jobb', () => {
    expect(code).not.toMatch(/cron\.schedule/i);
    expect(rollbackSql).not.toMatch(/cron\.schedule/i);
  });
});

describe('migration 052_advisor_fixes.sql: pg_net', () => {
  const guardStart = at("e.extname = 'pg_net' and n.nspname = 'public'");

  it('gör ingenting om pg_net inte ligger i schemat public', () => {
    expect(guardStart).toBeGreaterThan(-1);
    expect(body.slice(guardStart - 200, guardStart)).toMatch(/if exists \(\s*select 1 from pg_extension e join pg_namespace n on n\.oid = e\.extnamespace where\s*$/);
    expect(guardStart).toBeLessThan(at("p.prosrc ~* 'net\\.http_'"));
    expect(guardStart).toBeLessThan(at('drop extension'));
  });

  it('undantar event trigger-funktioner och schemana net, extensions, pg_catalog och information_schema ur kontrollen av användare', () => {
    expect(body).toContain('p.oid not in (select evtfoid from pg_event_trigger)');
    expect(body).toContain("n.nspname not in ('net', 'extensions', 'pg_catalog', 'information_schema')");
    // supabase_functions räknas bara om en icke-intern trigger anropar funktionen.
    expect(body).toContain("n.nspname <> 'supabase_functions' or exists (select 1 from pg_trigger t where t.tgfoid = p.oid and not t.tgisinternal)");
  });

  it('kontrollerar även kvarvarande cron-jobb som använder net.http_ innan något tas bort', () => {
    expect(body).toContain("where command ~* 'net\\.http_'");
    expect(at("where command ~* 'net\\.http_'")).toBeLessThan(at('drop extension'));
  });

  it('tar bort pg_net utan cascade, i ett eget block som fångar saknat ägarskap och beroenden', () => {
    expect(code.match(/drop\s+extension/gi)).toHaveLength(1);
    expect(body).not.toMatch(/drop extension[^;]*cascade/);
    const dropAt = at('drop extension');
    const blockStart = body.lastIndexOf('begin', dropAt);
    const handler = body.slice(dropAt, body.indexOf('end;', dropAt));
    expect(blockStart).toBeGreaterThan(at('p.prosrc'));
    expect(handler).toContain('exception when insufficient_privilege or dependent_objects_still_exist then');
    expect(handler).toContain('raise notice');
  });

  it('avbryter aldrig migrationen på pg_net: inga raise exception, så funktion, vy och cron alltid blir kvar', () => {
    expect(code).not.toMatch(/raise\s+exception/i);
  });

  it('lämnar pg_cron kvar', () => {
    expect(code).not.toMatch(/drop\s+extension[^;]*pg_cron/i);
  });
});

describe('migration 052_advisor_fixes.sql: title_leaderboard_view', () => {
  it('sätter security_invoker = true med alter view och rör inga behörigheter eller vydefinitionen', () => {
    expect(body).toContain('alter view public.title_leaderboard_view set (security_invoker = true);');
    expect(code).not.toMatch(/create\s+(or\s+replace\s+)?view/i);
  });
});

describe('migrationer efter 052 som återskapar title_leaderboard_view', () => {
  it('upptäcker en återskapad vy utan security_invoker (create or replace ersätter alternativen)', () => {
    expect(viewStatementsWithoutInvoker('create or replace view public.title_leaderboard_view as select 1;')).toHaveLength(1);
    expect(viewStatementsWithoutInvoker('CREATE VIEW title_leaderboard_view AS SELECT 1;')).toHaveLength(1);
    expect(viewStatementsWithoutInvoker('create or replace view public.title_leaderboard_view with (security_barrier) as select 1;')).toHaveLength(1);
    expect(viewStatementsWithoutInvoker('create or replace view public.title_leaderboard_view with (security_invoker = true) as select 1;')).toHaveLength(0);
    expect(viewStatementsWithoutInvoker('create or replace view public.title_leaderboard_view with (security_barrier, security_invoker = true) as select 1;')).toHaveLength(0);
    expect(viewStatementsWithoutInvoker('-- create or replace view public.title_leaderboard_view as select 1;\nselect 1;')).toHaveLength(0);
    expect(viewStatementsWithoutInvoker('create view public.other_view as select 1;')).toHaveLength(0);
  });

  it('kräver security_invoker = true i varje migration över 052 som skapar title_leaderboard_view', () => {
    const later = readdirSync(migrationsDir)
      .filter((name) => /^\d+_.*\.sql$/.test(name) && Number.parseInt(name, 10) > 52)
      .sort();
    const offenders = later.filter((name) => viewStatementsWithoutInvoker(readFileSync(resolve(migrationsDir, name), 'utf8')).length > 0);
    expect(offenders).toEqual([]);
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

  it('ligger i ett enda do-block (som 051) så att allt går eller inget, även med psql -f utan en omslutande transaktion', () => {
    expect(body.startsWith('do $do$ declare')).toBe(true);
    expect(body.endsWith('end $do$;')).toBe(true);
    expect(code.match(/\$do\$/g)).toHaveLength(2);
    expect(code.match(/\bdo\s+\$/gi)).toHaveLength(1);
    // Funktionen och vyn skapas före cron- och pg_net-stegen, så att ett fel där aldrig lämnar dem ogjorda.
    expect(at('create or replace function public.increment_event_xp')).toBeLessThan(at('alter view'));
    expect(at('alter view')).toBeLessThan(at("to_regclass('cron.job')"));
  });

  it('headern har rollback som återskapar funktionen exakt som i baslinjen, vyn utan alternativ och pg_net i schemat extensions', () => {
    const fnRollback = FUNCTION_RE.exec(rollbackSql);
    expect(fnRollback, 'rollback för funktionen saknas').not.toBeNull();
    expect(normalize(fnRollback![0])).toBe(normalize(baselineFunction![0]));
    expect(normalize(rollbackSql)).toContain('alter view public.title_leaderboard_view reset (security_invoker);');
    expect(normalize(rollbackSql)).toContain('create extension if not exists pg_net with schema extensions;');
  });
});
