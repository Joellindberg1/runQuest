// Vakt för docs/runbook-backup-compare.sql: filen körs av ägaren mot PROD och mot en återställd kopia, så den får aldrig kunna skriva.
// Textbaserad och avsiktligt snäv: den läser SQL-satserna (kommentarer bortrensade) och kräver att varje block är
// `begin read only; <en SELECT/WITH-sats>; rollback;`. Det är tidigare lager än databasen; `begin read only` är det som håller i Postgres.
// Körs med `node --test scripts/*.test.mjs`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Satserna i en SQL-text utan radkommentarer, normaliserade till gemener och ett blanksteg mellan orden. */
export function statementsOf(sql) {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter((statement) => statement.length > 0);
}

const WRITE_OR_ADMIN_WORDS = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|execute|set|commit|vacuum|reindex|comment|lock|notify|listen|into)\b/;

/** Tomma listan = filen är skrivskyddad enligt vakten. */
export function readOnlyViolations(sql) {
  const violations = [];
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

describe('docs/runbook-backup-compare.sql', () => {
  it('är skrivskyddad: bara SELECT, varje block inom begin read only och rollback', () => {
    const sql = readFileSync(join(root, 'docs', 'runbook-backup-compare.sql'), 'utf8');
    assert.deepEqual(readOnlyViolations(sql), []);
  });
});
