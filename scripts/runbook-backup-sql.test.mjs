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
        } else i += 1;
      }
      if (!closed) problems.push('osluten sträng');
      out += "'s'";
    } else {
      out += ch;
      i += 1;
    }
  }
  return { code: out.replace(/\s+/g, ' ').toLowerCase(), problems };
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

// Ord som får stå direkt före en parentes utan att vara ett funktionsanrop.
const KEYWORDS_BEFORE_PAREN = new Set(['as', 'from', 'filter', 'in', 'over', 'and', 'or', 'not', 'on', 'where', 'union', 'all', 'select', 'with', 'exists', 'by', 'then', 'else', 'when', 'case', 'values', 'join', 'using', 'any', 'some', 'between', 'like', 'is', 'distinct', 'having', 'group', 'order', 'limit', 'by']);

function functionViolations(statement) {
  const violations = [];
  for (const match of statement.matchAll(/([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*)\s*\(/g)) {
    const name = match[1];
    if (name.includes('.')) violations.push(`funktion med schema: ${name}(`);
    else if (!ALLOWED_FUNCTIONS.has(name) && !KEYWORDS_BEFORE_PAREN.has(name)) violations.push(`funktionen ${name}( finns inte på vitlistan`);
  }
  return violations;
}

/** Tomma listan = filen är skrivskyddad enligt vakten. */
export function readOnlyViolations(sql) {
  const { problems } = stripSql(sql);
  const violations = [...problems];
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
      violations.push(...functionViolations(statement));
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

describe('docs/runbook-backup-compare.sql', () => {
  it('är skrivskyddad: bara SELECT, varje block inom begin read only och rollback', () => {
    const sql = readFileSync(join(root, 'docs', 'runbook-backup-compare.sql'), 'utf8');
    assert.deepEqual(readOnlyViolations(sql), []);
  });
});
