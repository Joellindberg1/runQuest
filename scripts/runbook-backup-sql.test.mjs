// Vakt för docs/runbook-backup-compare.sql: filen körs av ägaren mot PROD och mot en återställd kopia, så den får aldrig kunna skriva.
//
// Den verkliga garantin är att filen BARA innehåller SELECT/WITH-satser med funktioner från en vitlista; det är vad den här vakten
// kontrollerar. `begin read only` i filen är ett extra lager som bara gäller om klienten inte redan öppnat en transaktion.
//
// Vakten lexar SQL:en i stället för att söka text: radkommentarer (--) och strängar ('…', med '' som escape) tas bort först och i
// rätt ordning, så en sträng som innehåller `--` döljer ingenting. Allt som skulle kunna dölja kod för lexern fälls direkt:
// blockkommentarer, dollarcitat ($), citerade namn ("…"), snedstreck, och prefixerade strängar (e'…', b'…', u&'…').
// Radbrytningen normaliseras först (CRLF -> LF). Körs med `node --test scripts/*.test.mjs`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Tar bort radkommentarer och byter ut varje sträng mot 's'. Returnerar den rensade texten (gemener, blanksteg hopdragna) och
 * de konstruktioner som vakten inte vill lexa (de fäller filen).
 */
export function stripSql(rawSql) {
  const sql = rawSql.replace(/\r\n?/g, '\n');
  const problems = [];
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
    } else if (ch === '/' && next === '*') {
      problems.push('blockkommentar (/*) är inte tillåten');
      i += 2;
    } else if (ch === '$') {
      problems.push('dollartecken ($, dollarcitat eller parameter) är inte tillåtet');
      i += 1;
    } else if (ch === '"') {
      problems.push('citerat namn (") är inte tillåtet');
      i += 1;
    } else if (ch === '\\') {
      problems.push('snedstreck (\\) är inte tillåtet');
      i += 1;
    } else if (ch === "'") {
      if (/[a-z0-9_&]/i.test(out[out.length - 1] ?? '')) problems.push("prefixerad sträng (e'…', b'…', u&'…') är inte tillåten");
      i += 1;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") {
          closed = true;
          i += 1;
          break;
        } else {
          if (sql[i] === '\\') problems.push('snedstreck (\\) är inte tillåtet, inte heller inuti en sträng');
          i += 1;
        }
      }
      if (!closed) problems.push('osluten sträng');
      out += "'s'";
    } else {
      // Utanför strängar och kommentarer: bara ASCII. Homoglyfer och hårda blanksteg kan annars få ett ord att se ut som ett annat.
      if (ch.charCodeAt(0) > 0x7f) problems.push(`tecken utanför ASCII (U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}) utanför en sträng`);
      out += ch;
      i += 1;
    }
  }
  // Blanksteg runt punkter tas bort så att `public . count(` läses som `public.count(` (schemaprefixregeln).
  return { code: out.replace(/\s+/g, ' ').replace(/ ?\. ?/g, '.').toLowerCase(), problems };
}

/** Satserna i en SQL-text efter stripSql, utan tomma. */
export function statementsOf(sql) {
  return stripSql(sql)
    .code.split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

// Svartlista: ord som aldrig hör hemma i en läsfråga. Vitlistan nedan är det som håller; det här ger ett tydligare felmeddelande.
const WRITE_OR_ADMIN_WORDS =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|execute|set|reset|commit|abort|vacuum|reindex|cluster|analyze|refresh|comment|lock|notify|listen|unlisten|into|for|role|session|authorization|prepare|declare|fetch|show|load|import|savepoint|release|discard|checkpoint|security)\b/;

// Vitlista: de enda funktionerna som får anropas. Allt annat (pg_terminate_backend, set_config, dblink_*, pg_sleep, lo_*, egna) fäller.
const ALLOWED_FUNCTIONS = new Set(['count', 'max', 'min', 'coalesce', 'now', 'cast', 'current_database', 'pg_database_size', 'pg_size_pretty', 'to_char']);

// Ord som får stå direkt före en parentes utan att vara ett funktionsanrop. Bara RESERVERADE ord, som inte kan vara funktionsnamn
// och därför inte kan dölja ett anrop. Icke-reserverade ord (by, over, like …) står inte här: ett användardefinierat `over(` ska fällas.
// `filter` är icke-reserverat men filen behöver `count(*) filter (where …)`; det släpps därför bara igenom i exakt den formen.
const KEYWORDS_BEFORE_PAREN = new Set(['as', 'from', 'in', 'and', 'or', 'not', 'on', 'where', 'union', 'all', 'select', 'with', 'exists', 'then', 'else', 'when', 'case', 'values', 'join', 'using', 'any', 'some', 'between', 'is', 'distinct', 'having', 'group', 'order', 'limit']);

function functionViolations(statement) {
  const violations = [];
  for (const match of statement.matchAll(/([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*)\s*\(/g)) {
    const name = match[1];
    const afterParen = statement.slice(match.index + match[0].length);
    if (name.includes('.')) violations.push(`funktion med schema: ${name}(`);
    else if (name === 'filter' && afterParen.startsWith('where ')) continue;
    else if (!ALLOWED_FUNCTIONS.has(name) && !KEYWORDS_BEFORE_PAREN.has(name)) violations.push(`funktionen ${name}( finns inte på vitlistan`);
  }
  return violations;
}

// Känsliga kolumner får aldrig nämnas i filen (inte ens i kommentarer): filen läser antal, aldrig innehåll.
const SENSITIVE_COLUMNS = /(access_token|refresh_token|password_hash|email)/i;

// strava_tokens får bara förekomma i dessa två former (BLOCK A och BLOCK B). Allt som blir kvar av namnet när de tagits bort fäller.
const STRAVA_TOKENS_FORMS = [
  /select 's'(?: as \w+)?, count\(\*\)(?: as \w+)?, max\(created_at\)::text(?: as \w+)? from public\.strava_tokens/g,
  /select 's', count\(\*\) filter \(where created_at <= \(select t from punkt\)\)(?: as \w+)?, count\(\*\)(?: as \w+)? from public\.strava_tokens/g,
];

function stravaTokensViolations(statement) {
  if (!statement.includes('strava_tokens')) return [];
  const remainder = STRAVA_TOKENS_FORMS.reduce((text, form) => text.replace(form, ''), statement);
  return remainder.includes('strava_tokens') ? ['strava_tokens används på annat sätt än count(*) och max(created_at)'] : [];
}

/** Tomma listan = filen är skrivskyddad enligt vakten. */
export function readOnlyViolations(sql) {
  const { problems } = stripSql(sql);
  const violations = [...problems];
  const sensitive = sql.match(SENSITIVE_COLUMNS);
  if (sensitive) violations.push(`känslig kolumn "${sensitive[1]}" får inte nämnas i filen`);
  const statements = statementsOf(sql);
  let open = false;
  for (const statement of statements) {
    if (statement === 'begin read only') {
      if (open) violations.push('begin read only inuti ett öppet block');
      open = true;
    } else if (statement === 'rollback') {
      if (!open) violations.push('rollback utan öppet block');
      open = false;
    } else if (/^(select|with) /.test(statement)) {
      if (!open) violations.push(`sats utanför begin read only: ${statement.slice(0, 40)}`);
      const word = statement.match(WRITE_OR_ADMIN_WORDS);
      if (word) violations.push(`förbjudet ord "${word[0]}" i: ${statement.slice(0, 60)}`);
      violations.push(...functionViolations(statement), ...stravaTokensViolations(statement));
    } else {
      violations.push(`oväntad sats: ${statement.slice(0, 60)}`);
    }
  }
  if (open) violations.push('blocket saknar rollback');
  if (statements.length === 0) violations.push('filen innehåller inga satser');
  return violations;
}

describe('readOnlyViolations', () => {
  it('accepterar ett skrivskyddat block', () => {
    assert.deepEqual(readOnlyViolations('begin read only;\nselect 1; -- kommentar med insert\nrollback;'), []);
  });

  it('fäller skrivningar, även dolda i en WITH-sats', () => {
    assert.notDeepEqual(readOnlyViolations('begin read only; delete from users; rollback;'), []);
    assert.notDeepEqual(readOnlyViolations('begin read only; with x as (delete from users returning *) select * from x; rollback;'), []);
    assert.notDeepEqual(readOnlyViolations('begin read only; select * into kopia from users; rollback;'), []);
  });

  it('fäller en sats utanför ett skrivskyddat block och ett block utan rollback', () => {
    assert.notDeepEqual(readOnlyViolations('select 1;'), []);
    assert.notDeepEqual(readOnlyViolations('begin read only; select 1;'), []);
    assert.notDeepEqual(readOnlyViolations('begin; select 1; rollback;'), []);
  });
});

describe('readOnlyViolations: försök att smuggla in en skrivning', () => {
  const block = (statement) => `begin read only;\n${statement};\nrollback;`;
  const rejected = [
    ['copy', "copy users to program 'x'"],
    ['do med dollarcitat', 'do $$ begin delete from users; end $$'],
    ['set role', 'set role postgres'],
    ['commit mitt i blocket', 'commit'],
    ['kommentartrick: sträng med -- före en skrivning', "select '--'; delete from users"],
    ['kommentartrick: blockkommentar', 'select 1 /* ; delete from users */'],
    ['dollarcitat som sträng', 'select $x$ ; delete from users; $x$'],
    ['pg_terminate_backend', 'select pg_terminate_backend(pid) from pg_stat_activity'],
    ['set_config', "select set_config('role', 'postgres', false)"],
    ['dblink', "select dblink_exec('dbname=x', 'delete from users')"],
    ['pg_sleep', 'select pg_sleep(60)'],
    ['funktion med schema', 'select public.count(*) from users'],
    ['select for update', 'select * from users for update'],
    ['citerat funktionsnamn', `select "set_config"('a', 'b', false)`],
    ['escape-sträng', "select e'\\'; delete from users; --'"],
  ];
  for (const [name, statement] of rejected) {
    it(`fäller: ${name}`, () => {
      assert.notDeepEqual(readOnlyViolations(block(statement)), []);
    });
  }

  it('accepterar en fil med radbrytningen CRLF och en kommentar som nämner delete', () => {
    const sql = ['-- delete from users', 'begin read only;', 'select count(*) from public.users;', 'rollback;', ''].join('\r\n');
    assert.deepEqual(readOnlyViolations(sql), []);
  });

  it('accepterar tillåtna funktioner och strängar med -- och semikolon i', () => {
    const statement = "select coalesce(max(created_at)::text, 'a -- b; c'), pg_database_size(current_database()) from public.users";
    assert.deepEqual(readOnlyViolations(block(statement)), []);
  });
});

describe('readOnlyViolations: lexern och vitlistan', () => {
  const block = (statement) => `begin read only;\n${statement};\nrollback;`;
  const rejected = [
    ['schemaprefix med blanksteg runt punkten', 'select public . count(*) from public.users'],
    ['schemaprefix med radbrytning runt punkten', 'select public\n.\ncount(*) from public.users'],
    ['homoglyf (icke-ASCII) utanför en sträng', 'select count(*) frоm public.users'],
    ['hårt blanksteg (icke-ASCII) utanför en sträng', 'select count(*) from public.users'],
    ['snedstreck inuti en sträng', "select 'a\\b' from public.users"],
    ['filter som funktionsnamn', 'select filter(1) from public.users'],
    ['over som funktionsnamn', 'select over(1) from public.users'],
    ['filter utan where', 'select count(*) filter (1) from public.users'],
    ['kolumnen access_token', 'select access_token from public.strava_tokens'],
    ['kolumnen refresh_token', 'select refresh_token from public.strava_tokens'],
    ['kolumnen password_hash', 'select password_hash from public.users'],
    ['kolumnen email', 'select email from public.users'],
    ['strava_tokens med stjärna', 'select * from public.strava_tokens'],
    ['strava_tokens med en annan kolumn', 'select user_id from public.strava_tokens'],
    ['strava_tokens i en CTE', 'with t as (select * from public.strava_tokens) select count(*) from t'],
    ['strava_tokens utan schema', "select 'x', count(*), max(created_at)::text from strava_tokens"],
  ];
  for (const [name, statement] of rejected) {
    it(`fäller: ${name}`, () => {
      assert.notDeepEqual(readOnlyViolations(block(statement)), []);
    });
  }

  it('fäller en förbjuden kolumn även i en kommentar', () => {
    assert.notDeepEqual(readOnlyViolations('-- vi läser aldrig password_hash\nbegin read only;\nselect 1;\nrollback;'), []);
  });

  it('accepterar icke-ASCII i kommentarer och strängar', () => {
    assert.deepEqual(readOnlyViolations("-- Återställning\nbegin read only;\nselect 'Ärende' as etikett;\nrollback;"), []);
  });

  it('accepterar count med filter (where …) och bara antalet och senaste skapad ur strava_tokens', () => {
    assert.deepEqual(readOnlyViolations(block('select count(*) filter (where created_at is not null) from public.users')), []);
    assert.deepEqual(readOnlyViolations(block("select 'strava_tokens (bara antal)', count(*), max(created_at)::text from public.strava_tokens")), []);
  });
});

describe('docs/runbook-backup-compare.sql', () => {
  it('är skrivskyddad: bara SELECT, varje block inom begin read only och rollback', () => {
    const sql = readFileSync(join(root, 'docs', 'runbook-backup-compare.sql'), 'utf8');
    assert.deepEqual(readOnlyViolations(sql), []);
  });
});
