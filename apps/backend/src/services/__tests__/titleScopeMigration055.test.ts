/**
 * Statiskt test: migration 055 flyttar titlarnas omfång till (användare, grupp): group_id på user_titles och title_leaderboard, nya
 * unika nycklar, omslagsfunktioner med oförändrade signaturer, BEFORE INSERT-shim för v0.7.x-koden och en vy med group_id sist
 * (ADR 012 beslut 1 och 3). Läser SQL-filen från disk, ingen databas.
 *
 * Varför beteendet bara läses och inte körs här: advisory-lås, plpgsql, unika nycklar, triggers och DO-block finns bara i Postgres, och
 * staging och prod är förbjudna för en builder. Testerna fäster därför det som GÖR beteendet: nycklarnas kolumner och namn, att varje
 * villkor sitter ihop med sin raise, att rebuild-funktionen är avgränsad på gruppen, att triggern är avstängd medan group_id fylls i,
 * att före/efter-beviset körs i migrationen, och att rollbacken i huvudet har körts mot en riktig Postgres (PGlite) i builderns bevis (inte i Supabases egen
 * miljö; testet binder dess ordning och innehåll, inte att den är identisk där). Beviset i en riktig databas är katalogfrågorna och EXCEPT-frågorna i migrationens header, som Lead kör i staging.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, '../../../migrations');
const file = '055_title_scope_group.sql';
const sql = readFileSync(resolve(migrationsDir, file), 'utf8');

// Kommentarer bort så att rollback-SQL:en och bevisfrågorna i headern inte räknas som körbar kod.
const code = sql.replace(/--.*$/gm, '');
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim();
const at = (haystack: string, re: RegExp) => haystack.search(re);

// Funktions- och DO-block innehåller semikolon, så de tas ut som enheter och resten delas i satser.
const extract = (re: RegExp): string => code.match(re)?.[0] ?? '';
const fnRe = (name: string) => new RegExp(`create or replace function public\\.${name}\\([^)]*\\)[\\s\\S]*?\\$function\\$;`, 'i');
const groupFn = extract(fnRe('update_group_title_leaderboard'));
const groupAllFn = extract(fnRe('update_group_title_leaderboards'));
const wrapperFn = extract(fnRe('update_title_leaderboard'));
const wrapperAllFn = extract(fnRe('update_all_title_leaderboards'));
const triggerFn = extract(fnRe('trigger_update_title_leaderboard'));
const shimFn = extract(fnRe('user_titles_fill_group_id'));
const preflight = extract(/do \$preflight\$[\s\S]*?\$preflight\$;/i);
const snapshot = extract(/do \$snapshot\$[\s\S]*?\$snapshot\$;/i);
const constraints = extract(/do \$constraints\$[\s\S]*?\$constraints\$;/i);
const postcheck = extract(/do \$postcheck\$[\s\S]*?\$postcheck\$;/i);
const statements = [groupFn, groupAllFn, wrapperFn, wrapperAllFn, triggerFn, shimFn, preflight, snapshot, constraints, postcheck]
  .reduce((rest, block) => (block ? rest.replace(block, ' ') : rest), code)
  .split(';')
  .map(normalize)
  .filter(Boolean);
const stmtIndex = (start: string) => statements.findIndex((s) => s.startsWith(start));

const body = (fn: string) => normalize(fn.slice(fn.search(/\bbegin\b/i)).replace(/\$function\$;\s*$/, ''));
const groupBody = body(groupFn);
const groupAllBody = body(groupAllFn);
const wrapperBody = body(wrapperFn);
const wrapperAllBody = body(wrapperAllFn);
const triggerBody = body(triggerFn);
const shimBody = body(shimFn);
const preflightBody = normalize(preflight);
const snapshotBody = normalize(snapshot);
const constraintsBody = normalize(constraints);
const postcheckBody = normalize(postcheck);

/** Rader i headern som är körbar SQL: `--` följt av minst tre blanksteg, mellan två markörer. */
function headerBlock(name: string): string[] {
  const start = sql.indexOf(`-- ${name}-START`);
  const end = sql.indexOf(`-- ${name}-END`);
  expect(start, `${name}-START saknas`).toBeGreaterThan(-1);
  expect(end, `${name}-END saknas`).toBeGreaterThan(start);
  return sql
    .slice(start, end)
    .split(/\r?\n/)
    .filter((l) => /^--\s{3,}\S/.test(l) && !/^--\s+--/.test(l))
    .map((l) => l.replace(/^--\s{3}/, ''));
}

describe(`migration ${file}: kolumner och unika nycklar`, () => {
  it('group_id läggs till på båda tabellerna med främmande nyckel till groups, on delete cascade', () => {
    expect(statements).toContain(
      'alter table public.user_titles add column if not exists group_id uuid references public.groups(id) on delete cascade',
    );
    expect(statements).toContain(
      'alter table public.title_leaderboard add column if not exists group_id uuid references public.groups(id) on delete cascade',
    );
  });

  it('group_id fylls ur users.group_id (bara rader utan grupp), sedan NOT NULL, i den ordningen', () => {
    const fillUt = stmtIndex('update public.user_titles ut set group_id = u.group_id');
    const fillTl = stmtIndex('update public.title_leaderboard tl set group_id = u.group_id');
    expect(statements[fillUt]).toBe(
      'update public.user_titles ut set group_id = u.group_id from public.users u where u.id = ut.user_id and ut.group_id is null',
    );
    expect(statements[fillTl]).toBe(
      'update public.title_leaderboard tl set group_id = u.group_id from public.users u where u.id = tl.user_id and tl.group_id is null',
    );
    const addUt = stmtIndex('alter table public.user_titles add column');
    const addTl = stmtIndex('alter table public.title_leaderboard add column');
    const notNullUt = statements.indexOf('alter table public.user_titles alter column group_id set not null');
    const notNullTl = statements.indexOf('alter table public.title_leaderboard alter column group_id set not null');
    expect(addUt).toBeGreaterThan(-1);
    expect(addUt).toBeLessThan(fillUt);
    expect(addTl).toBeLessThan(fillTl);
    expect(fillUt).toBeLessThan(notNullUt);
    expect(fillTl).toBeLessThan(notNullTl);
    expect(notNullUt).toBeGreaterThan(-1);
    expect(notNullTl).toBeGreaterThan(-1);
  });

  it('unika nycklar: (user_id, group_id, title_id), (group_id, title_id, position) och (group_id, title_id, user_id), var och en bara om den saknas', () => {
    const expected: [string, string, string][] = [
      ['public.user_titles', 'user_titles_user_group_title_key', 'unique (user_id, group_id, title_id)'],
      ['public.title_leaderboard', 'title_leaderboard_group_title_position_key', 'unique (group_id, title_id, "position")'],
      ['public.title_leaderboard', 'title_leaderboard_group_title_user_key', 'unique (group_id, title_id, user_id)'],
    ];
    for (const [table, name, def] of expected) {
      // Villkoret och add constraint hör ihop: samma tabell och samma namn, annars hoppar en omkörning över fel nyckel eller skapar den två gånger.
      expect(constraintsBody).toContain(
        `if not exists (select 1 from pg_constraint where conrelid = '${table}'::regclass and conname = '${name}') then alter table ${table} add constraint ${name} ${def}; end if;`,
      );
    }
    expect(constraintsBody.match(/add constraint/g)).toHaveLength(4);
  });

  it('titles_current_holder_id_fkey byts till ON DELETE SET NULL, bara om den inte redan är det, och drop och add hör ihop', () => {
    expect(constraintsBody).toContain(
      "if not exists (select 1 from pg_constraint where conrelid = 'public.titles'::regclass and conname = 'titles_current_holder_id_fkey' and confdeltype = 'n') then alter table public.titles drop constraint if exists titles_current_holder_id_fkey; alter table public.titles add constraint titles_current_holder_id_fkey foreign key (current_holder_id) references public.users(id) on delete set null; end if;",
    );
    // Slutkontrollen kräver att nyckeln verkligen blev SET NULL.
    expect(postcheckBody).toContain(
      "select count(*) into v_holder_fk from pg_constraint c where c.conrelid = 'public.titles'::regclass and c.conname = 'titles_current_holder_id_fkey' and c.confdeltype <> 'n'; if v_holder_fk > 0 then raise exception 'migration 055 failed: titles_current_holder_id_fkey is not on delete set null",
    );
  });

  it('de gamla globala unika nycklarna släpps, och först efter att de nya finns', () => {
    const drops = [
      'alter table public.user_titles drop constraint if exists user_titles_user_id_title_id_key',
      'alter table public.title_leaderboard drop constraint if exists title_leaderboard_title_id_position_key',
      'alter table public.title_leaderboard drop constraint if exists title_leaderboard_title_id_user_id_key',
    ];
    for (const drop of drops) expect(statements).toContain(drop);
    const doBlockAt = at(code, /do \$constraints\$/i);
    for (const d of ['user_titles_user_id_title_id_key', 'title_leaderboard_title_id_position_key', 'title_leaderboard_title_id_user_id_key']) {
      expect(at(code, new RegExp(`drop constraint if exists ${d}`, 'i'))).toBeGreaterThan(doBlockAt);
    }
    // Primärnycklarna och position-CHECK (1 till 10, topp 10 per grupp) rörs inte.
    expect(code).not.toMatch(/user_titles_pkey|title_leaderboard_pkey|title_leaderboard_position_check/i);
  });

  it('index (group_id, title_id, value desc) på user_titles', () => {
    expect(statements).toContain(
      'create index if not exists idx_user_titles_group_title_value on public.user_titles (group_id, title_id, value desc)',
    );
    expect(code).not.toMatch(/\bconcurrently\b/i); // kan inte köras i apply_migrations transaktion
  });
});

describe(`migration ${file}: shim för v0.7.x-koden`, () => {
  it('BEFORE INSERT-trigger på user_titles fyller group_id ur users.group_id, bara när den saknas', () => {
    expect(statements).toContain('drop trigger if exists user_titles_group_id_shim on public.user_titles');
    expect(statements).toContain(
      'create trigger user_titles_group_id_shim before insert on public.user_titles for each row execute function public.user_titles_fill_group_id()',
    );
    // Bara INSERT: en UPDATE ska aldrig skriva om en befintlig titels grupp i tysthet.
    expect(code).not.toMatch(/before\s+(insert\s+or\s+update|update)/i);
    expect(normalize(shimFn)).toMatch(
      /^create or replace function public\.user_titles_fill_group_id\(\) returns trigger language plpgsql set search_path to ''/,
    );
    expect(shimBody).toBe(
      'begin if new.group_id is null then select u.group_id into new.group_id from public.users u where u.id = new.user_id; end if; return new; end;',
    );
  });

  it('användare utan grupp får group_id null och stoppas av NOT NULL (fail-closed), shimmen kastar inget och hittar inte på någon grupp', () => {
    expect(shimBody).not.toMatch(/raise|coalesce|insert|limit|group_members/);
    expect(statements).toContain('alter table public.user_titles alter column group_id set not null');
  });
});

describe(`migration ${file}: omslagsfunktioner med oförändrade signaturer`, () => {
  it('update_title_leaderboard(uuid), update_all_title_leaderboards() och trigger_update_title_leaderboard() har samma signatur, returtyp och search_path som förut', () => {
    expect(normalize(wrapperFn)).toMatch(
      /^create or replace function public\.update_title_leaderboard\(p_title_id uuid\) returns void language plpgsql set search_path to ''/,
    );
    expect(normalize(wrapperAllFn)).toMatch(
      /^create or replace function public\.update_all_title_leaderboards\(\) returns void language plpgsql set search_path to ''/,
    );
    expect(normalize(triggerFn)).toMatch(
      /^create or replace function public\.trigger_update_title_leaderboard\(\) returns trigger language plpgsql set search_path to ''/,
    );
  });

  it('de nya funktionerna har signaturerna (group_id, title_id) och (group_id), fast search_path och inget security definer', () => {
    expect(normalize(groupFn)).toMatch(
      /^create or replace function public\.update_group_title_leaderboard\(p_group_id uuid, p_title_id uuid\) returns void language plpgsql set search_path to ''/,
    );
    expect(normalize(groupAllFn)).toMatch(
      /^create or replace function public\.update_group_title_leaderboards\(p_group_id uuid\) returns void language plpgsql set search_path to ''/,
    );
    expect(code).not.toMatch(/\bsecurity\s+definer\b/i);
  });

  it('omslaget loopar över alla grupper i id-ordning och anropar rebuild per (grupp, titel)', () => {
    expect(wrapperBody).toBe(
      'begin for v_group_id in select g.id from public.groups g order by g.id loop perform public.update_group_title_leaderboard(v_group_id, p_title_id); end loop; end;',
    );
    expect(normalize(wrapperFn)).toContain('declare v_group_id uuid; begin');
    expect(normalize(wrapperAllFn)).toContain('declare v_group_id uuid; begin');
    expect(normalize(groupAllFn)).toContain('declare v_title_id uuid; begin');
    expect(wrapperAllBody).toBe(
      'begin for v_group_id in select g.id from public.groups g order by g.id loop perform public.update_group_title_leaderboards(v_group_id); end loop; end;',
    );
    expect(groupAllBody).toBe(
      'begin for v_title_id in select t.id from public.titles t order by t.id loop perform public.update_group_title_leaderboard(p_group_id, v_title_id); end loop; end;',
    );
  });

  it('triggern tar gruppen direkt ur NEW/OLD.group_id och bygger bara om den berörda (grupp, titel); en flyttad rad bygger även om den gamla', () => {
    expect(triggerBody).toBe(
      "begin if tg_op = 'insert' or tg_op = 'update' then perform public.update_group_title_leaderboard(new.group_id, new.title_id); " +
        "if tg_op = 'update' and (old.group_id is distinct from new.group_id or old.title_id is distinct from new.title_id) then perform public.update_group_title_leaderboard(old.group_id, old.title_id); end if; return new; end if; " +
        "if tg_op = 'delete' then perform public.update_group_title_leaderboard(old.group_id, old.title_id); return old; end if; return null; end;",
    );
    // Ingen uppslagning mot users i triggern: en kaskadraderad användare finns inte längre där.
    expect(triggerBody).not.toMatch(/public\.users|select /);
  });

  it('funktionerna använder bara schemakvalificerade tabeller, eftersom search_path är tom', () => {
    for (const fnBody of [groupBody, groupAllBody, wrapperBody, wrapperAllBody, shimBody, preflightBody, snapshotBody, postcheckBody]) {
      const relations = [...fnBody.matchAll(/\b(?:from|(?<!for )update|join|into|delete from)\s+([a-z_][a-z0-9_.]*)/g)]
        .map((m) => m[1]!)
        // plpgsql-variabler efter "into" (v_*, new.*) och alias efter "from (" räknas inte som tabeller.
        .filter((name) => !name.startsWith('v_') && !name.startsWith('new.') && !name.startsWith('pg_temp.') && name !== 'information_schema.columns');
      for (const relation of relations) {
        expect(
          [
            'public.groups',
            'public.titles',
            'public.users',
            'public.user_titles',
            'public.title_leaderboard',
            'public.group_members',
            'pg_constraint',
            'pg_proc',
            'pg_views',
            'pg_matviews',
            'pg_policies',
            'pg_trigger',
            'pg_attribute',
            'pg_index',
          ],
          `${relation}`,
        ).toContain(relation);
      }
    }
  });

  it('funktionerna kan bara köras av service_role (execute indraget från public, anon och authenticated)', () => {
    const newFns = ['update_group_title_leaderboard(uuid, uuid)', 'update_group_title_leaderboards(uuid)', 'user_titles_fill_group_id()'];
    for (const fn of newFns) {
      expect(statements).toContain(`revoke execute on function public.${fn} from public, anon, authenticated`);
      expect(statements).toContain(`grant execute on function public.${fn} to service_role`);
    }
    expect(statements.filter((s) => s.startsWith('grant '))).toHaveLength(3);
    // De gamla funktionerna behåller sina behörigheter (create or replace rör dem inte): migrationen ändrar inga andra grants.
    expect(statements.filter((s) => s.startsWith('revoke execute'))).toHaveLength(3);
    expect(code).not.toMatch(/grant\s+[^;]*\bto\s+(public|anon|authenticated)\b/i);
  });
});

describe(`migration ${file}: rebuild per grupp (update_group_title_leaderboard)`, () => {
  it('kräver grupp och titel, tar lås per (grupp, titel) före all läsning och skrivning, och lämnar en raderad grupp ifred', () => {
    expect(groupBody).toMatch(
      /^begin if p_group_id is null or p_title_id is null then raise exception 'update_group_title_leaderboard: group_and_title_required' using errcode = '22004'; end if; perform 1 from public\.titles where id = p_title_id for no key update; if not found then return; end if; perform pg_advisory_xact_lock\(hashtextextended\('title_leaderboard:' \|\| p_group_id::text \|\| ':' \|\| p_title_id::text, 0\)\); if not exists \(select 1 from public\.groups where id = p_group_id\) then return; end if; /,
    );
    const lockAt = at(groupBody, /pg_advisory_xact_lock/);
    const rowLockAt = at(groupBody, /perform 1 from public\.titles where id = p_title_id for no key update/);
    const stampAt = at(groupBody, /update public\.titles set updated_at/);
    // Deadlock-fri ordning: titles-radens lås, sedan advisory-låset, sedan allt annat, sist stämplingen (ADR 012, kritikerns F1).
    expect(rowLockAt).toBeGreaterThan(-1);
    expect(rowLockAt).toBeLessThan(lockAt);
    expect(lockAt).toBeLessThan(stampAt);
    for (const dml of [/delete from public\.title_leaderboard/, /insert into public\.title_leaderboard/, /update public\.titles/, /from public\.user_titles/]) {
      expect(at(groupBody, dml)).toBeGreaterThan(lockAt);
    }
    expect(code).not.toMatch(/pg_advisory_lock\(|pg_try_advisory/i); // xact-varianten: släpps vid transaktionens slut
  });

  it('radlåset på titles är FOR NO KEY UPDATE, aldrig FOR UPDATE (FOR UPDATE krockar med key share från varje insert och deadlockar två inserts)', () => {
    expect(groupBody).toContain('for no key update');
    expect(code).not.toMatch(/\bfor\s+update\b/i);
    expect([...code.matchAll(/\bfor\s+no\s+key\s+update\b/gi)]).toHaveLength(1);
  });

  it('raderar och bygger om bara den här gruppens rader för titeln', () => {
    expect(groupBody).toContain('delete from public.title_leaderboard where group_id = p_group_id and title_id = p_title_id;');
    // Utan group_id i delete skulle en rebuild för grupp A radera grupp B:s lista.
    expect([...groupBody.matchAll(/delete from public\.title_leaderboard where ([^;]*);/g)].map((m) => m[1])).toEqual([
      'group_id = p_group_id and title_id = p_title_id',
    ]);
    expect(groupBody).toContain(
      'insert into public.title_leaderboard (group_id, title_id, user_id, "position", value, earned_at) select p_group_id, p_title_id, ut.user_id,',
    );
    expect(groupBody).toContain('from public.user_titles ut where ut.group_id = p_group_id and ut.title_id = p_title_id and ut.value is not null');
  });

  it('topp 10 per grupp, ordning value desc, earned_at asc, user_id asc, och bara aktiva medlemmar', () => {
    const order = 'order by ut.value desc, ut.earned_at asc, ut.user_id asc';
    expect(groupBody).toContain(`row_number() over (${order}) as "position"`);
    expect(groupBody).toMatch(new RegExp(`\\) ${order} limit 10;`));
    expect(groupBody).toContain(
      'and exists (select 1 from public.group_members m where m.group_id = ut.group_id and m.user_id = ut.user_id and m.left_at is null)',
    );
  });

  it('stämplar titles.updated_at men skriver inte current_holder_id eller current_value (ingen läsare, ADR 012 beslut 1.5)', () => {
    expect(groupBody).toMatch(/update public\.titles set updated_at = now\(\) where id = p_title_id; end;$/);
    // Ingen funktion (och därmed inget som en omkörnings förkontroll skulle räkna som läsare) nämner kolumnerna; bara förkontrollen letar efter namnet.
    for (const fn of [groupFn, groupAllFn, wrapperFn, wrapperAllFn, triggerFn, shimFn]) expect(fn).not.toMatch(/current_holder_id|current_value/i);
    // Utanför förkontrollen nämns kolumnen bara i den främmande nyckeln (namn och kolumnlista) som byts till on delete set null.
    const withoutFk = code.replace(preflight, '').replace(/titles_current_holder_id_fkey/g, '').replace(/foreign key \(current_holder_id\)/g, '');
    expect(withoutFk).not.toMatch(/current_holder_id|current_value/i);
  });
});

describe(`migration ${file}: vyn title_leaderboard_view`, () => {
  const viewSql = extract(/create or replace view public\.title_leaderboard_view[\s\S]*?;/i);
  const view = normalize(viewSql.replace(/;\s*$/, ''));

  it('återskapas med security_invoker = true (create or replace ersätter vyns alternativ från 052)', () => {
    expect(view).toMatch(/^create or replace view public\.title_leaderboard_view with \(security_invoker = true\) as select /);
    expect(code).not.toMatch(/security_barrier|security_invoker\s*=\s*false/i);
  });

  it('har samma kolumner i samma ordning som förut och group_id sist', () => {
    const list = view.slice(view.indexOf(' as select ') + 11, view.indexOf(' from '));
    const columns = list
      .split(/,(?![^()]*\))/)
      .map((c) => c.trim())
      .map((c) => c.split(/ as /).pop()!.replace(/^(?:t|tl|u)\./, ''));
    expect(columns).toEqual([
      'title_id',
      'title_name',
      'title_description',
      'unlock_requirement',
      'metric_key',
      '"position"',
      'user_id',
      'user_name',
      'user_gender',
      'profile_picture',
      'value',
      'earned_at',
      'status',
      'group_id',
    ]);
    expect(list).toContain('tl.group_id');
    expect(list).toContain("case when tl.\"position\" = 1 then 'holder'::text when tl.\"position\" <= 3 then 'runner_up'::text else 'top_10'::text end as status");
  });

  it('joinar som förut (titles left join title_leaderboard left join users) utan gruppfilter, så titlar utan innehavare finns kvar', () => {
    expect(view).toContain(
      'from public.titles t left join public.title_leaderboard tl on t.id = tl.title_id left join public.users u on tl.user_id = u.id',
    );
    expect(view).not.toMatch(/\bwhere\b/);
    expect(view).toMatch(/order by t\.name, tl\.group_id, tl\."position"$/);
  });

  it('rör inga behörigheter på vyn (create or replace behåller 039:s revoke) och ger inga grants till klientroller', () => {
    expect(code).not.toMatch(/\b(grant|revoke)\b[^;]*title_leaderboard_view/i);
    expect(code).not.toMatch(/\bcreate\s+policy\b|\balter\s+policy\b|enable row level security|disable row level security/i);
  });
});

describe(`migration ${file}: förkontroll`, () => {
  it('stoppar om group_members saknas (053 inte körd)', () => {
    expect(preflightBody).toMatch(
      /if to_regclass\('public\.group_members'\) is null then raise exception 'migration 055 stopped: public\.group_members is missing[^']*'; end if;/,
    );
  });

  it('första körningen är när user_titles saknar group_id, och stoppen mot flera grupper och grupplösa gäller bara då', () => {
    expect(preflightBody).toContain(
      "v_first_run := not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_titles' and column_name = 'group_id');",
    );
    expect(preflightBody).toMatch(/if v_first_run then select count\(distinct group_id\) into v_groups .*? end if; (?:-- )?/);
    expect(preflightBody).toMatch(
      /select count\(distinct group_id\) into v_groups from public\.users where group_id is not null; if v_groups > 1 then raise exception 'migration 055 stopped: % groups have members, expected exactly 1 [^']*', v_groups; end if;/,
    );
  });

  it('stoppar vid titelinnehavare utan grupp (user_titles och title_leaderboard), var och en med sin raise', () => {
    for (const table of ['user_titles', 'title_leaderboard']) {
      const alias = table === 'user_titles' ? 'ut' : 'tl';
      expect(preflightBody).toContain(
        `select count(*) into v_ungrouped from public.${table} ${alias} join public.users u on u.id = ${alias}.user_id where u.group_id is null; if v_ungrouped > 0 then`,
      );
      expect(preflightBody).toMatch(
        new RegExp(
          `from public\\.${table} ${alias} join public\\.users u on u\\.id = ${alias}\\.user_id where u\\.group_id is null order by ${alias}\\.user_id limit 10\\) x; raise exception 'migration 055 stopped: % rows in ${table} belong to users without a group [^']*', v_ungrouped, v_ungrouped_ids; end if;`,
        ),
      );
    }
  });

  it('stoppar vid titelinnehavare utan aktivt medlemskap i sin grupp (053:s backfill saknas eller glappar)', () => {
    for (const table of ['user_titles', 'title_leaderboard']) {
      const alias = table === 'user_titles' ? 'ut' : 'tl';
      expect(preflightBody).toContain(
        `select count(*) into v_no_membership from public.${table} ${alias} join public.users u on u.id = ${alias}.user_id where not exists (select 1 from public.group_members m where m.user_id = u.id and m.group_id = u.group_id and m.left_at is null); if v_no_membership > 0 then raise exception 'migration 055 stopped: % rows in ${table} belong to users without an active membership in their group`,
      );
    }
  });

  it('stoppar om något annat än update_title_leaderboard läser titles.current_holder_id (funktion, vy, materialiserad vy, policy eller trigger)', () => {
    expect(preflightBody).toContain("p.proname <> 'update_title_leaderboard'");
    for (const source of ['pg_proc p', 'pg_views v', 'pg_matviews m', 'pg_policies pol', 'pg_trigger t']) {
      expect(preflightBody).toContain(`from ${source}`);
    }
    expect((preflightBody.match(/~ 'current_holder_id'/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(preflightBody).toMatch(
      /if v_readers is not null then raise exception 'migration 055 stopped: titles\.current_holder_id is read by %[^']*', v_readers; end if;/,
    );
  });

  it('förkontrollen ändrar eller raderar ingenting och körs före första ändringen', () => {
    expect(preflightBody).not.toMatch(/\b(insert|update|delete|truncate|drop|alter)\b/);
    expect(statements[0]).toBe("set local lock_timeout = '5s'");
    expect(at(code, /do \$preflight\$/i)).toBeLessThan(at(code, /alter table public\.user_titles add column/i));
    expect(at(code, /do \$preflight\$/i)).toBeLessThan(at(code, /do \$snapshot\$/i));
  });
});

describe(`migration ${file}: trigger avstängd medan group_id fylls, före/efter-bevis i migrationen`, () => {
  const disable = 'alter table public.user_titles disable trigger title_leaderboard_update_trigger';
  const enable = 'alter table public.user_titles enable trigger title_leaderboard_update_trigger';

  it('rebuild-triggern är avstängd under backfillen och påslagen igen före den avslutande ombyggnaden', () => {
    const d = statements.indexOf(disable);
    const e = statements.indexOf(enable);
    const fill = stmtIndex('update public.user_titles ut set group_id');
    const rebuild = statements.indexOf('select public.update_all_title_leaderboards()');
    expect(d).toBeGreaterThan(-1);
    expect(d).toBeLessThan(fill);
    expect(fill).toBeLessThan(e);
    expect(e).toBeLessThan(rebuild);
    // Ett enda disable och ett enda enable: ingen annan trigger stängs av.
    expect(statements.filter((s) => /disable trigger|enable trigger/.test(s))).toEqual([disable, enable]);
    expect(code).not.toMatch(/disable trigger all|session_replication_role/i);
  });

  it('title_leaderboard_update_trigger återskapas inte och shimmen skapas före påslaget', () => {
    expect(code).not.toMatch(/create trigger title_leaderboard_update_trigger/i);
    expect(statements.findIndex((s) => s.startsWith('create trigger user_titles_group_id_shim'))).toBeLessThan(statements.indexOf(enable));
  });

  it('före-snapshoten tas i migrationen före första ändringen av data eller schema och är en temporär tabell per tabell', () => {
    expect(snapshotBody).toContain('drop table if exists pg_temp.mig055_before_tl;');
    expect(snapshotBody).toContain(
      'create temp table mig055_before_tl as select title_id, user_id, "position", value, earned_at from public.title_leaderboard;',
    );
    expect(snapshotBody).toContain('create temp table mig055_before_ut as select user_id, title_id, value, earned_at from public.user_titles;');
    expect(snapshotBody).toContain(
      "create temp table mig055_run as select not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_titles' and column_name = 'group_id') as first_run;",
    );
    expect(at(code, /do \$snapshot\$/i)).toBeLessThan(at(code, /alter table public\.user_titles add column/i));
    // Inte on commit drop: apply utan omslutande transaktion skulle släppa tabellen direkt.
    expect(code).not.toMatch(/on commit drop/i);
  });

  it('slutkontrollen jämför före och efter med EXCEPT i båda riktningarna, bara första körningen, och stoppar annars', () => {
    expect(postcheckBody).toContain('if (select first_run from pg_temp.mig055_run) then');
    for (const [snap, cols, table] of [
      ['mig055_before_tl', 'title_id, user_id, "position", value, earned_at', 'public.title_leaderboard'],
      ['mig055_before_ut', 'user_id, title_id, value, earned_at', 'public.user_titles'],
    ] as const) {
      expect(postcheckBody).toContain(`(select ${cols} from ${table} except select ${cols} from pg_temp.${snap})`);
      expect(postcheckBody).toContain(`(select ${cols} from pg_temp.${snap} except select ${cols} from ${table})`);
    }
    expect(postcheckBody).toMatch(
      /if v_diff_tl > 0 or v_diff_ut > 0 then raise exception 'migration 055 failed: the title holders or values changed \(% rows differ in title_leaderboard, % in user_titles\)[^']*', v_diff_tl, v_diff_ut; end if;/,
    );
    expect(at(code, /do \$postcheck\$/i)).toBeGreaterThan(at(code, /select public\.update_all_title_leaderboards\(\)/i));
  });

  it('slutkontrollen kräver 0 rader utan group_id, att varje unik nyckel på tabellerna har group_id, och släpper snapshot-tabellerna', () => {
    expect(postcheckBody).toMatch(
      /select count\(\*\) into v_null_ut from public\.user_titles where group_id is null; select count\(\*\) into v_null_tl from public\.title_leaderboard where group_id is null; if v_null_ut > 0 or v_null_tl > 0 then raise exception 'migration 055 failed: [^']*', v_null_ut, v_null_tl; end if;/,
    );
    expect(postcheckBody).toContain("c.contype = 'u' and not (select a.attnum from pg_attribute a where a.attrelid = c.conrelid and a.attname = 'group_id') = any (c.conkey)");
    expect(postcheckBody).toMatch(/if v_global_keys > 0 then raise exception 'migration 055 failed: [^']*', v_global_keys; end if;/);
    expect(postcheckBody).toContain('drop table pg_temp.mig055_before_tl, pg_temp.mig055_before_ut, pg_temp.mig055_run;');
  });

  it('den avslutande ombyggnaden kommer efter vyn och funktionerna', () => {
    const rebuild = at(code, /select public\.update_all_title_leaderboards\(\)/i);
    expect(rebuild).toBeGreaterThan(at(code, /create or replace view public\.title_leaderboard_view/i));
    expect(rebuild).toBeGreaterThan(at(code, /create or replace function public\.update_group_title_leaderboard\(/i));
  });
});

describe(`migration ${file}: form, idempotens och rollback`, () => {
  it('första satsen är lock_timeout, ingen egen transaktion, inga data raderas', () => {
    expect(statements[0]).toBe("set local lock_timeout = '5s'");
    expect(code).not.toMatch(/\bset\s+(session\s+)?lock_timeout\b/i);
    // code är utan kommentarer, så rollback-blocket och orden i headern räknas inte.
    expect(code).not.toMatch(/\bbegin\s*;|\bcommit\b|\brollback\b/i);
    expect('begin;').toMatch(/\bbegin\s*;|\bcommit\b|\brollback\b/i); // regexen träffar det den ska
    // Inga delete från användardata utanför rebuild-funktionen (title_leaderboard är härledd), ingen truncate/drop av tabeller eller kolumner.
    // Enda drop table är snapshot-tabellerna (pg_temp.mig055_*), som den här körningen själv skapat.
    expect(code.replace(groupFn, '')).not.toMatch(
      /\bdelete\s+from\b|\btruncate\b|\bdrop\s+column\b|\bdrop\s+table\s+(?!if\s+exists\s+pg_temp\.mig055_|pg_temp\.mig055_)/i,
    );
    expect([...code.matchAll(/\bdrop\s+table\s+(?:if\s+exists\s+)?(\S+)/gi)].map((m) => m[1])).toEqual([
      'pg_temp.mig055_before_tl;',
      'pg_temp.mig055_before_ut;',
      'pg_temp.mig055_run;',
      'pg_temp.mig055_before_tl,',
    ]);
    expect(code).not.toMatch(/\balter\s+table\b[^;]*\bdrop\s+column\b/i);
  });

  it('migrationen skapar inga tabeller, policyer eller extra funktioner utöver de fem och shimmen', () => {
    expect(code.match(/create or replace function public\.\w+/gi)!.map((m) => m.replace(/create or replace function public\./i, ''))).toEqual([
      'update_group_title_leaderboard',
      'update_group_title_leaderboards',
      'update_title_leaderboard',
      'update_all_title_leaderboards',
      'trigger_update_title_leaderboard',
      'user_titles_fill_group_id',
    ]);
    expect(code).not.toMatch(/create\s+table\b/i); // bara create temp table
  });

  it('rollback i huvudet återställer 042-funktionerna, släpper det nya och återskapar de globala nycklarna, vyn sist', () => {
    const rollback = headerBlock('ROLLBACK')
      .join('\n')
      .split(/;\s*(?:\n|$)/)
      .map(normalize)
      .filter(Boolean);
    const idx = (start: string) => rollback.findIndex((s) => s.startsWith(start));
    const dropView = idx('drop view if exists public.title_leaderboard_view');
    const dropShim = idx('drop trigger if exists user_titles_group_id_shim');
    const restoreWrapper = idx('create or replace function public.update_title_leaderboard(p_title_id uuid)');
    const dropGroupFn = idx('drop function if exists public.update_group_title_leaderboards(uuid)');
    const dropColumns = idx('alter table public.user_titles drop column group_id');
    const addKey = idx('alter table public.user_titles add constraint user_titles_user_id_title_id_key unique (user_id, title_id)');
    const createView = idx('create view public.title_leaderboard_view with (security_invoker = true)');
    const restoreFkDrop = idx('alter table public.titles drop constraint titles_current_holder_id_fkey');
    const restoreFkAdd = idx('alter table public.titles add constraint titles_current_holder_id_fkey foreign key (current_holder_id) references public.users(id)');
    const finalRebuild = idx('select public.update_all_title_leaderboards()');
    // Rollbacken är en transaktion med lock_timeout först, och återställer NO ACTION (utan on delete) innan den avslutande ombyggnaden.
    expect(rollback[0]).toBe("set local lock_timeout = '5s'");
    expect(restoreFkDrop).toBeGreaterThan(-1);
    expect(restoreFkAdd).toBe(restoreFkDrop + 1);
    expect(restoreFkAdd).toBeLessThan(finalRebuild);
    expect(rollback[restoreFkAdd]).not.toMatch(/on delete/);
    const revokeView = idx('revoke select on public.title_leaderboard_view from anon, authenticated');
    for (const i of [dropView, dropShim, restoreWrapper, dropGroupFn, dropColumns, addKey, createView, revokeView]) expect(i).toBeGreaterThan(-1);
    // Vyn måste bort före kolumnen den läser; funktionerna återställs före kolumnen släpps; vyn skapas sist.
    expect(dropView).toBeLessThan(dropColumns);
    expect(dropShim).toBeLessThan(dropColumns);
    expect(dropColumns).toBeLessThan(addKey);
    expect(addKey).toBeLessThan(createView);
    expect(createView).toBeLessThan(revokeView);
    expect(rollback.filter((s) => s.startsWith('drop function if exists'))).toEqual([
      'drop function if exists public.update_group_title_leaderboards(uuid)',
      'drop function if exists public.update_group_title_leaderboard(uuid, uuid)',
      'drop function if exists public.user_titles_fill_group_id()',
    ]);
    // Återställningen av vyn är den ursprungliga (ingen group_id) och behåller security_invoker från 052.
    expect(rollback[createView]).not.toContain('group_id');
    expect(rollback[createView]).toMatch(/with \(security_invoker = true\) as select/);
  });

  it('huvudet innehåller före-snapshot- och EXCEPT-frågorna och katalogfrågorna som Lead kör', () => {
    const queries = headerBlock('QUERIES').join('\n');
    // Före-snapshot (SELECT) för båda tabellerna, sparas som JSON.
    expect(queries).toMatch(/jsonb_agg\(to_jsonb\(s\) order by s\.title_id, s\."position"\)[\s\S]*from public\.title_leaderboard/);
    expect(queries).toMatch(/jsonb_agg\(to_jsonb\(s\) order by s\.user_id, s\.title_id\)[\s\S]*from public\.user_titles/);
    // EXCEPT i båda riktningarna för båda tabellerna.
    expect(queries.match(/\bexcept\b/gi)!.length).toBeGreaterThanOrEqual(4);
    // A7: exakt lika (title_id, value, earned_at) kan ge annan ordning med nya tie-breaken.
    expect(queries).toMatch(/group by title_id, value, earned_at having count\(\*\) > 1/);
    // Katalogfrågor: index, trigger, funktioners signatur/search_path/grants och vyns security_invoker + kolumner.
    for (const token of ['pg_indexes', 'pg_trigger', 'pg_get_function_identity_arguments', 'proconfig', 'has_function_privilege', 'reloptions', 'information_schema.columns', 'pg_constraint']) {
      expect(queries, token).toContain(token);
    }
  });

  it('huvudet anger ordningen 053 -> 054 -> 055, att inget körs mot prod av en builder, och att detta är ägar-ja per miljö', () => {
    expect(sql).toMatch(/EJ APPLICERAD/);
    expect(sql).toMatch(/053/);
    expect(sql).toMatch(/054/);
    expect(sql).toMatch(/aldrig av en builder/);
    // Körvillkor: ingen synk/cron/omräkning pågår, och 40P01 eller lock_timeout betyder kör om.
    expect(sql).toMatch(/KÖR NÄR INGET ANNAT SKRIVER TITLAR[\s\S]*Strava-synk[\s\S]*40P01[\s\S]*lock_timeout[\s\S]*KÖR OM/);
    expect(sql).toMatch(/EN transaktion[\s\S]*lock_timeout/);
  });
});
