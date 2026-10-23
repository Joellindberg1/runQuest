/**
 * Statiskt test: migration 058 är contract-migrationen för titelrankingen (ADR 012 beslut 8): den släpper rebuild-triggern och shim-triggern på
 * user_titles, de fyra funktionerna (update_title_leaderboard, update_all_title_leaderboards, trigger_update_title_leaderboard,
 * user_titles_fill_group_id), kolumnerna titles.current_holder_id/current_value och slutstämplingen av titles.updated_at. Läser SQL-filen från disk,
 * ingen databas.
 *
 * Varför beteendet bara läses och inte körs här: plpgsql, pg_depend, triggers och DO-block finns bara i Postgres, och staging och prod är förbjudna
 * för en builder. Testerna fäster därför det som GÖR beteendet: ordningen (förkontroll, snapshot, drop, ersatt funktion, postcheck), att inget släpps med
 * cascade, att förkontrollen stoppar på varje sorts beroende, att slutkontrollen jämför före/efter med EXCEPT i båda riktningarna INKLUSIVE position, och att
 * rollbacken i huvudet återskapar 055/056-läget. Beviset i en riktig databas är builderns PGlite-körning (en prod-lik datamängd, förkontrollens alla stopp,
 * rollbacken) och frågorna i migrationens header, som Lead kör i staging och prod före och efter.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, '../../../migrations');
const file = '058_contract_title_ranking.sql';
const sql = readFileSync(resolve(migrationsDir, file), 'utf8');

// Kommentarer bort så att rollback-SQL:en och bevisfrågorna i headern inte räknas som körbar kod.
const code = sql.replace(/--.*$/gm, '');
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim();
const at = (haystack: string, re: RegExp) => haystack.search(re);
const extract = (re: RegExp): string => code.match(re)?.[0] ?? '';

const groupFn = extract(/create or replace function public\.update_group_title_leaderboard\([^)]*\)[\s\S]*?\$function\$;/i);
const preflight = extract(/do \$preflight\$[\s\S]*?\$preflight\$;/i);
const lockBlock = extract(/do \$lock\$[\s\S]*?\$lock\$;/i);
const snapshot = extract(/do \$snapshot\$[\s\S]*?\$snapshot\$;/i);
const postcheck = extract(/do \$postcheck\$[\s\S]*?\$postcheck\$;/i);
const statements = [groupFn, lockBlock, preflight, snapshot, postcheck]
  .reduce((rest, block) => (block ? rest.replace(block, ' ') : rest), code)
  .split(';')
  .map(normalize)
  .filter(Boolean);
const groupBody = normalize(groupFn.slice(groupFn.search(/\bbegin\b/i)).replace(/\$function\$;\s*$/, ''));
const preflightBody = normalize(preflight);
const snapshotBody = normalize(snapshot);
const postcheckBody = normalize(postcheck);

/** Rader i headern mellan två markörer, med de tre inledande blanksteg efter `--` borttagna. */
function headerBlock(name: string): string[] {
  const start = sql.indexOf(`-- ${name}-START`);
  const end = sql.indexOf(`-- ${name}-END`);
  expect(start, `${name}-START saknas`).toBeGreaterThan(-1);
  expect(end, `${name}-END saknas`).toBeGreaterThan(start);
  return sql
    .slice(start, end)
    .split(/\r?\n/)
    .filter((l) => l.startsWith('--   ') && !l.startsWith('--   --'))
    .map((l) => l.slice(5));
}

const FUNCTIONS = ['trigger_update_title_leaderboard()', 'user_titles_fill_group_id()', 'update_title_leaderboard(uuid)', 'update_all_title_leaderboards()'];

describe(`migration ${file}: form och ordning`, () => {
  it('börjar med lock_timeout 5 s och har ingen egen transaktion', () => {
    expect(statements[0]).toBe("set local lock_timeout = '5s'");
    expect(code).not.toMatch(/\bbegin\s*;|\bcommit\b|\brollback\b/i);
  });

  it('tar alla lås direkt efter lock_timeout, före förkontrollen: alla fyra tabellerna i en sats, i funktionens ordning, med nowait och omförsök', () => {
    const lockBody = normalize(lockBlock);
    // En sats, fyra tabeller, ordningen är rebuild-funktionens första beröring: titles, title_leaderboard, user_titles, users.
    expect(lockBody).toContain('lock table public.titles, public.title_leaderboard, public.user_titles, public.users in access exclusive mode nowait;');
    expect((lockBody.match(/\block table\b/g) ?? [])).toHaveLength(1);
    // Upptaget lås: undertransaktionen släpper de redan tagna, vi väntar utanför satsen och försöker igen; efter 20 försök stoppar den.
    expect(lockBody).toContain('exception when lock_not_available then');
    expect(lockBody).toContain('if v_attempt >= 20 then raise exception');
    expect(lockBody).toContain('perform pg_sleep(0.25);');
    expect(lockBody).toContain('nothing was changed');
    expect(lockBody).toMatch(/^do \$lock\$ declare v_attempt integer := 0; begin loop v_attempt := v_attempt \+ 1; begin lock table/);
    // Låset kommer före allt som läser eller ändrar, och inget annat lock table finns i filen.
    expect(at(code, /do \$lock\$/i)).toBeGreaterThan(at(code, /set local lock_timeout/i));
    expect(at(code, /do \$lock\$/i)).toBeLessThan(at(code, /do \$preflight\$/i));
    expect((code.match(/\block\s+table\b/gi) ?? [])).toHaveLength(1);
    expect(code).not.toMatch(/\block table\b(?![^;]*\bnowait\b)/i);
  });

  it('huvudet säger att users får ACCESS EXCLUSIVE (inte SHARE ROW EXCLUSIVE), att migrationen aldrig väntar medan den håller lås, och att rollbacken inte återställer kolumnordningen', () => {
    expect(sql).not.toMatch(/SHARE ROW EXCLUSIVE på users/);
    expect(sql).toMatch(/ACCESS EXCLUSIVE på users/);
    expect(sql).toContain('verifierat i PGlite med pg_locks');
    expect(sql).toContain('VÄNTAR ALDRIG medan den håller ett lås');
    expect(sql).toContain('återställer SCHEMA OCH CONSTRAINTS');
    expect(sql).toContain('INTE kolumnordningen');
    const rollbackIntro = sql.slice(sql.indexOf('-- ROLLBACK (körs'), sql.indexOf('-- ROLLBACK-START'));
    expect(rollbackIntro).not.toMatch(/\bexakt/i);
  });

  it('förkontroll, snapshot, triggrar, funktioner, ersatt funktion, kolumner och slutkontroll kommer i den ordningen', () => {
    const order = [
      at(code, /do \$preflight\$/i),
      at(code, /do \$snapshot\$/i),
      at(code, /drop trigger if exists user_titles_group_id_shim/i),
      at(code, /drop trigger if exists title_leaderboard_update_trigger/i),
      at(code, /drop function if exists public\.trigger_update_title_leaderboard\(\)/i),
      at(code, /create or replace function public\.update_group_title_leaderboard\(/i),
      at(code, /alter table public\.titles drop column if exists current_holder_id/i),
      at(code, /alter table public\.titles drop column if exists current_value/i),
      at(code, /do \$postcheck\$/i),
    ];
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('släpper triggrarna före funktionerna de kör, och funktionerna med exakta signaturer', () => {
    const dropTriggers = statements.filter((s) => s.startsWith('drop trigger'));
    expect(dropTriggers).toEqual([
      'drop trigger if exists user_titles_group_id_shim on public.user_titles',
      'drop trigger if exists title_leaderboard_update_trigger on public.user_titles',
    ]);
    expect(statements.filter((s) => s.startsWith('drop function'))).toEqual(FUNCTIONS.map((f) => `drop function if exists public.${f}`));
    expect(Math.max(...dropTriggers.map((s) => statements.indexOf(s)))).toBeLessThan(statements.findIndex((s) => s.startsWith('drop function')));
  });

  it('släpper de två kolumnerna, och inget annat med drop column', () => {
    expect(statements.filter((s) => /\bdrop column\b/.test(s))).toEqual([
      'alter table public.titles drop column if exists current_holder_id',
      'alter table public.titles drop column if exists current_value',
    ]);
  });

  it('släpper ingenting med cascade (ett missat beroende ska avbryta, inte tas bort tyst)', () => {
    expect(code).not.toMatch(/\bcascade\b/i);
  });

  it('är idempotent: varje drop är if exists och funktionen är create or replace', () => {
    for (const s of statements.filter((x) => /^drop (trigger|function)/.test(x))) expect(s).toMatch(/^drop (trigger|function) if exists /);
    expect(code.match(/create or replace function public\.\w+/gi)).toHaveLength(1);
  });

  it('ändrar ingen data: ingen insert, update, delete eller truncate på toppnivå, och snapshot-tabellerna är de enda tabellerna som släpps', () => {
    expect(statements.join(';')).not.toMatch(/^(insert|update|delete|truncate)\b|;(insert|update|delete|truncate)\b/);
    const outsideFunction = code.replace(groupFn, '');
    expect(outsideFunction).not.toMatch(/\btruncate\b|\bdelete\s+from\b|\binsert\s+into\b/i);
    expect([...code.matchAll(/\bdrop\s+table\s+(?:if\s+exists\s+)?(\S+)/gi)].map((m) => m[1])).toEqual([
      'pg_temp.mig058_before_tl;',
      'pg_temp.mig058_before_ut;',
      'pg_temp.mig058_before_t;',
      'pg_temp.mig058_before_tl,',
    ]);
  });

  it('skapar inga tabeller, policyer, grants, vyer eller extra funktioner och rör inte vyn', () => {
    expect(code).not.toMatch(/create\s+(?!temp\b)table\b|\bcreate policy\b|\balter policy\b|\bgrant\b|\brevoke\b|\bcreate\s+(or\s+replace\s+)?view\b|\balter\s+view\b/i);
    expect(code).not.toMatch(/title_leaderboard_view/i);
    expect(code).not.toMatch(/\bcreate trigger\b/i);
  });
});

describe(`migration ${file}: förkontrollen`, () => {
  it('stoppar om 055 inte är körd (funktionerna eller user_titles.group_id saknas)', () => {
    expect(preflightBody).toContain("to_regprocedure('public.update_group_title_leaderboard(uuid, uuid)') is null or to_regprocedure('public.update_group_title_leaderboards(uuid)') is null");
    expect(preflightBody).toContain("table_name = 'user_titles' and column_name = 'group_id'");
    expect((preflightBody.match(/apply 055 first/g) ?? []).length).toBe(2);
  });

  it('stoppar på beroenden av funktionerna enligt pg_depend, utom de två kända triggrarna', () => {
    expect(preflightBody).toContain("d.refclassid = 'pg_proc'::regclass");
    for (const name of ['update_title_leaderboard', 'update_all_title_leaderboards', 'trigger_update_title_leaderboard', 'user_titles_fill_group_id']) expect(preflightBody).toContain(`'${name}'`);
    expect(preflightBody).toContain("t.tgname in ('title_leaderboard_update_trigger', 'user_titles_group_id_shim')");
    expect(preflightBody).toContain('depends on a function this migration drops');
  });

  it('stoppar på beroenden av kolumnerna enligt pg_depend, utom främmande nyckeln, indexet och kolumnens eget standardvärde', () => {
    expect(preflightBody).toContain("d.refobjid = 'public.titles'::regclass");
    expect(preflightBody).toContain("a.attname in ('current_holder_id', 'current_value')");
    expect(preflightBody).toContain("c.conname = 'titles_current_holder_id_fkey'");
    expect(preflightBody).toContain("to_regclass('public.idx_titles_current_holder_id')");
    expect(preflightBody).toContain("d.classid = 'pg_attrdef'::regclass");
    expect(preflightBody).toContain('depends on titles.current_holder_id or titles.current_value');
  });

  it('stoppar på text som nämner namnen: funktioner, vyer, materialiserade vyer, policyer och triggrar (plpgsql syns inte i pg_depend)', () => {
    for (const source of ['from pg_proc p', 'from pg_views v', 'from pg_matviews m', 'from pg_policies pol', 'from pg_trigger t']) expect(preflightBody, source).toContain(source);
    expect((preflightBody.match(/~ v_names/g) ?? []).length).toBeGreaterThanOrEqual(5);
    // Alla scheman utom systemscheman, inte bara public; undantaget för de fyra funktionerna gäller bara public.
    expect(preflightBody).toContain("p.pronamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)");
    expect(preflightBody).toContain("and not (p.pronamespace = 'public'::regnamespace and p.proname in ('update_title_leaderboard', 'update_all_title_leaderboards', 'trigger_update_title_leaderboard', 'user_titles_fill_group_id'))");
    for (const alias of ['v.schemaname', 'm.schemaname', 'pol.schemaname']) expect(preflightBody, alias).toContain(`${alias} not in ('pg_catalog', 'information_schema')`);
    expect(preflightBody).not.toMatch(/(v|m|pol)\.schemaname = 'public'/);
    expect(preflightBody).toContain("t.tgrelid = 'public.user_titles'::regclass and t.tgname in ('title_leaderboard_update_trigger', 'user_titles_group_id_shim')");
    for (const name of ['current_holder_id', 'current_value', 'update_title_leaderboard', 'update_all_title_leaderboards', 'trigger_update_title_leaderboard', 'user_titles_fill_group_id']) {
      expect(preflightBody).toContain(name);
    }
    expect(preflightBody).toContain('names a function or a column this migration drops');
  });

  it('stoppar på ett cron-jobb som nämner dem, bara om schemat cron finns', () => {
    expect(preflightBody).toContain("if to_regclass('cron.job') is not null then execute");
    expect(preflightBody).toContain('cron job(s)');
  });

  it('varje raise sitter ihop med sitt villkor och säger att inget ändrats', () => {
    const raises = [...preflight.matchAll(/raise exception '([^']*)'/g)].map((m) => m[1]);
    expect(raises).toHaveLength(6);
    for (const message of raises) expect(message).toMatch(/^migration 058 stopped: /);
    expect(raises.every((m) => /Nothing was changed/.test(m))).toBe(true);
    expect(preflightBody).not.toMatch(/\b(insert|update|delete|drop|alter|create)\b(?! table if exists)/);
  });
});

describe(`migration ${file}: snapshot och slutkontroll`, () => {
  it('tar före-snapshot av title_leaderboard (med position), user_titles och titles (utan de släppta kolumnerna) som temporära tabeller', () => {
    expect(snapshotBody).toContain('create temp table mig058_before_tl as select group_id, title_id, user_id, "position", value, earned_at from public.title_leaderboard');
    expect(snapshotBody).toContain('create temp table mig058_before_ut as select user_id, group_id, title_id, value, earned_at from public.user_titles');
    expect(snapshotBody).toContain('create temp table mig058_before_t as select id, name, description, unlock_requirement, metric_key, outdoor_only, created_at, updated_at from public.titles');
    expect(snapshotBody).not.toMatch(/on commit drop/);
    expect(snapshotBody).toContain('drop table if exists pg_temp.mig058_before_tl');
  });

  it('jämför före/efter med EXCEPT i båda riktningarna för alla tre tabeller, position inräknad, utan undantag för byte av plats', () => {
    expect((postcheckBody.match(/\bexcept\b/g) ?? []).length).toBe(6);
    expect(postcheckBody).toContain('select group_id, title_id, user_id, "position", value, earned_at from public.title_leaderboard except select group_id, title_id, user_id, "position", value, earned_at from pg_temp.mig058_before_tl');
    expect(postcheckBody).toContain('select group_id, title_id, user_id, "position", value, earned_at from pg_temp.mig058_before_tl except select group_id, title_id, user_id, "position", value, earned_at from public.title_leaderboard');
    expect(postcheckBody).toContain('if v_diff_tl > 0 or v_diff_ut > 0 or v_diff_t > 0 then raise exception');
    // Till skillnad från 055 får ingenting byta plats: inga lika-grupper, ingen tie-undantag.
    expect(postcheckBody).not.toMatch(/tie|v_diff_grp|v_diff_pos|exactly equal/);
  });

  it('kontrollerar att funktionerna, triggrarna och kolumnerna är borta och att de två kvarvarande funktionerna är INVOKER, har fast search_path och bara kan köras av service_role', () => {
    expect(postcheckBody).toContain("p.proname in ('update_title_leaderboard', 'update_all_title_leaderboards', 'trigger_update_title_leaderboard', 'user_titles_fill_group_id')");
    expect(postcheckBody).toContain("t.tgname in ('title_leaderboard_update_trigger', 'user_titles_group_id_shim')");
    expect(postcheckBody).toContain("a.attname in ('current_holder_id', 'current_value') and not a.attisdropped");
    expect(postcheckBody).toContain("'public.update_group_title_leaderboard(uuid, uuid)'::regprocedure");
    expect(postcheckBody).toContain("'public.update_group_title_leaderboards(uuid)'::regprocedure");
    expect(postcheckBody).toContain("p.prosecdef or p.proconfig is distinct from array['search_path=\"\"']");
    expect(postcheckBody).toContain("a.grantee = 0 and a.privilege_type = 'execute'");
    expect(postcheckBody).toContain("has_function_privilege('anon', v_fn, 'execute')");
    expect(postcheckBody).toContain("has_function_privilege('authenticated', v_fn, 'execute')");
    expect(postcheckBody).toContain("not has_function_privilege('service_role', v_fn, 'execute')");
  });

  it('kontrollerar att rebuilden inte längre stämplar titles, släpper snapshot-tabellerna sist och står efter allt annat', () => {
    expect(postcheckBody).toContain("p.prosrc ~* 'update\\s+public\\.titles'");
    expect(postcheckBody).toContain('drop table pg_temp.mig058_before_tl, pg_temp.mig058_before_ut, pg_temp.mig058_before_t; end; $postcheck$;');
    expect(postcheckBody.lastIndexOf('drop table')).toBeGreaterThan(postcheckBody.lastIndexOf('raise exception'));
    expect(at(code, /do \$postcheck\$/i)).toBeGreaterThan(at(code, /alter table public\.titles drop column if exists current_value/i));
  });
});

describe(`migration ${file}: den ersatta rebuild-funktionen`, () => {
  it('stämplar inte titles och skriver ingen current_holder_id/current_value', () => {
    expect(groupBody).not.toMatch(/update public\.titles|current_holder_id|current_value|updated_at/);
  });

  it('behåller låsordningen från 055: titles-radlåset FOR NO KEY UPDATE, sedan advisory-låset, sedan grupp-kontrollen, delete, insert', () => {
    const order = [
      groupBody.indexOf('perform 1 from public.titles where id = p_title_id for no key update'),
      groupBody.indexOf("perform pg_advisory_xact_lock(hashtextextended('title_leaderboard:' || p_group_id::text || ':' || p_title_id::text, 0))"),
      groupBody.indexOf('if not exists (select 1 from public.groups where id = p_group_id)'),
      groupBody.indexOf('delete from public.title_leaderboard where group_id = p_group_id and title_id = p_title_id'),
      groupBody.indexOf('insert into public.title_leaderboard (group_id, title_id, user_id, "position", value, earned_at)'),
    ];
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(groupBody).not.toContain('for update');
  });

  it('bygger samma lista som 055: topp 10, aktiva medlemmar, value desc, earned_at asc, user_id asc', () => {
    expect(groupBody).toContain('row_number() over (order by ut.value desc, ut.earned_at asc, ut.user_id asc) as "position"');
    expect(groupBody).toContain('and ut.value is not null');
    expect(groupBody).toContain('exists (select 1 from public.group_members m where m.group_id = ut.group_id and m.user_id = ut.user_id and m.left_at is null)');
    expect(groupBody).toContain('order by ut.value desc, ut.earned_at asc, ut.user_id asc limit 10');
  });

  it('har samma signatur, returtyp, språk och search_path som 055 och kräver båda argumenten (22004)', () => {
    expect(normalize(groupFn)).toMatch(/^create or replace function public\.update_group_title_leaderboard\(p_group_id uuid, p_title_id uuid\) returns void language plpgsql set search_path to ''/);
    expect(groupBody).toContain("raise exception 'update_group_title_leaderboard: group_and_title_required' using errcode = '22004'");
  });

  it('är identisk med 055:s funktion utom slutstämplingen (kroppen, utan kommentarer och blanksteg)', () => {
    const old055 = readFileSync(resolve(migrationsDir, '055_title_scope_group.sql'), 'utf8').replace(/--.*$/gm, '');
    const oldFn = old055.match(/create or replace function public\.update_group_title_leaderboard\([^)]*\)[\s\S]*?\$function\$;/i)?.[0] ?? '';
    const strip = (s: string) => normalize(s).replace(/ update public\.titles set updated_at = now\(\) where id = p_title_id;/, '');
    expect(oldFn).not.toBe('');
    expect(strip(groupFn)).toBe(strip(oldFn));
    expect(normalize(oldFn)).toContain('update public.titles set updated_at = now() where id = p_title_id;');
  });
});

describe(`migration ${file}: huvudet`, () => {
  it('anger syfte, status (ej applicerad), ordning, körordning, kör-när-inget-skriver, staging-sekvens och att en builder aldrig applicerar', () => {
    expect(sql).toMatch(/^-- 058: contract-migration/);
    expect(sql).toContain('APPLICERAD i staging 2026-10-19 och i prod 2026-10-23');
    expect(sql).toContain('ägar-ja per miljö');
    expect(sql).toMatch(/-- ORDNING: kräver 055 och 056/);
    expect(sql).toMatch(/-- KÖRORDNING:/);
    expect(sql).toContain('aldrig av en builder');
    expect(sql).toContain('KÖR NÄR INGET ANNAT SKRIVER TITLAR');
    expect(sql).toMatch(/-- STAGING-SEKVENS/);
    expect(sql).toContain('supabase-staging');
    expect(sql).toContain('apply_migration, name: 058_contract_title_ranking');
  });

  it('beskriver de tre uppdateringsvägarna och vilken som finns kvar', () => {
    expect(sql).toMatch(/-- BAKGRUND: DEN TREDUBBLA UPPDATERINGEN/);
    expect(sql).toMatch(/-- EN VÄG/);
    expect(sql).toContain('title_leaderboard_update_trigger');
    expect(sql).toContain('processGroupTitles');
    expect(sql).toContain('update_group_title_leaderboards');
  });

  it('har bevisfrågor före och efter som Lead kör: förekomst, beroenden, drift, fingeravtryck med position, innehavare, frusna värden, kvarvarande funktioner, RLS och klockan', () => {
    const queries = headerBlock('QUERIES').join('\n');
    for (const label of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B1', 'B2', 'B3', 'B4', 'C1']) expect(sql, label).toMatch(new RegExp(`-- ${label}\\. `));
    for (const token of ['pg_depend', 'pg_describe_object', 'pg_trigger', 'pg_attribute', 'md5(', 'has_function_privilege', 'reloptions', 'information_schema.columns', 'relrowsecurity', 'pg_policies']) {
      expect(queries, token).toContain(token);
    }
    expect((queries.match(/\bexcept\b/gi) ?? []).length).toBeGreaterThanOrEqual(2);
    // Fingeravtrycket för title_leaderboard räknar med position.
    expect(queries).toMatch(/concat_ws\('\|', group_id, title_id, user_id, "position", value, earned_at\)/);
    // Frågorna ändrar ingenting.
    expect(queries).not.toMatch(/\b(insert\s+into|update\s+public|delete\s+from|drop|alter|truncate)\b/i);
  });

  it('rollbacken återskapar 055/056-läget: kolumnerna med nyckel och index, funktionerna med stämplingen, grants bara för service_role, bägge triggrarna', () => {
    const rollback = headerBlock('ROLLBACK')
      .join('\n')
      .split(/;\s*(?:\n|$)/)
      .map(normalize)
      .filter(Boolean);
    const idx = (start: string) => rollback.findIndex((s) => s.startsWith(start));
    expect(rollback[0]).toBe("set local lock_timeout = '5s'");
    const addCols = [idx('alter table public.titles add column if not exists current_holder_id uuid'), idx('alter table public.titles add column if not exists current_value numeric(15,4) default 0')];
    const fk = idx('alter table public.titles add constraint titles_current_holder_id_fkey foreign key (current_holder_id) references public.users(id) on delete set null');
    const index = idx('create index if not exists idx_titles_current_holder_id on public.titles (current_holder_id)');
    const fns = ['update_group_title_leaderboard(p_group_id uuid, p_title_id uuid)', 'update_title_leaderboard(p_title_id uuid)', 'update_all_title_leaderboards()', 'trigger_update_title_leaderboard()', 'user_titles_fill_group_id()']
      .map((f) => idx(`create or replace function public.${f}`));
    const shim = idx('create trigger user_titles_group_id_shim before insert on public.user_titles for each row execute function public.user_titles_fill_group_id()');
    const rebuild = idx('create trigger title_leaderboard_update_trigger after insert or update or delete on public.user_titles for each row execute function public.trigger_update_title_leaderboard()');
    for (const i of [...addCols, fk, index, ...fns, shim, rebuild]) expect(i).toBeGreaterThan(-1);
    // Funktionerna finns före triggrarna som kör dem, kolumnen före nyckeln och indexet.
    expect(Math.max(...addCols)).toBeLessThan(fk);
    expect(fk).toBeLessThan(index);
    expect(Math.max(...fns)).toBeLessThan(Math.min(shim, rebuild));
    // Stämplingen av titles återställs i rebuild-funktionen.
    expect(normalize(headerBlock('ROLLBACK').join('\n'))).toContain('update public.titles set updated_at = now() where id = p_title_id;');
    // 056:s läge: ingen klientroll, bara service_role.
    for (const f of ['update_title_leaderboard(uuid)', 'update_all_title_leaderboards()', 'trigger_update_title_leaderboard()', 'user_titles_fill_group_id()']) {
      expect(rollback, f).toContain(`revoke execute on function public.${f} from public, anon, authenticated`);
      expect(rollback, f).toContain(`grant execute on function public.${f} to service_role`);
    }
    expect(rollback.filter((s) => /to (public|anon|authenticated)\b/.test(s) && s.startsWith('grant'))).toEqual([]);
  });

  it('innehåller ingen JWT, nyckel eller projektadress', () => {
    expect(sql).not.toMatch(/eyJ[A-Za-z0-9_-]{8,}/);
    expect(sql).not.toMatch(/https?:\/\//);
  });
});
