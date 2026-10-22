/**
 * Statiskt test: migration 059 lägger till user_boosts.start_date/end_date och backfyller befintliga rader med EXAKT det fönster koden räknade
 * förut (UTC-dygnen ur created_at och expires_at), så att reprocessRunsFromDate ger bitidentisk XP för gamla boostar. Läser SQL-filen från disk,
 * ingen databas.
 *
 * Beteendet körs inte här (staging och prod är förbjudna för en builder, och PGlite är inte ett beroende i repot). Testet fäster det som GÖR beteendet:
 * ordningen (förkontroll, kolumner, snapshot, backfyll, slutkontroll), att backfyllet bara rör rader utan fönster och räknar i UTC oberoende av sessionens
 * zon, att inget släpps eller ändras utöver de två kolumnerna, och rollbacken och frågorna i headern. Beviset i en riktig motor är builderns PGlite-körning
 * (2115 gamla boostar runt midnatt vid båda sommartidsskiftena, idempotens, rollback, förkontrollens och slutkontrollens stopp) och jämförelsen mot koden före
 * 059 i runs-boost-window.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = '059_user_boosts_window.sql';
const sql = readFileSync(resolve(__dirname, '../../../migrations', file), 'utf8');

const code = sql.replace(/--.*$/gm, '');
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const at = (re: RegExp) => code.search(re);
const extract = (re: RegExp): string => code.match(re)?.[0] ?? '';

const preflight = normalize(extract(/do \$preflight\$[\s\S]*?\$preflight\$;/i));
const snapshot = normalize(extract(/do \$snapshot\$[\s\S]*?\$snapshot\$;/i));
const postcheck = normalize(extract(/do \$postcheck\$[\s\S]*?\$postcheck\$;/i));
const backfill = normalize(extract(/update public\.user_boosts b[\s\S]*?;/i));

function headerBlock(name: string): string {
  const start = sql.indexOf(`-- ${name}-START`);
  const end = sql.indexOf(`-- ${name}-END`);
  expect(start, `${name}-START saknas`).toBeGreaterThan(-1);
  expect(end, `${name}-END saknas`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe(`migration ${file}: form och ordning`, () => {
  it('anger var den är applicerad och säger att bara Lead applicerar den', () => {
    expect(sql).toMatch(/APPLICERAD i staging 2026-10-20 och i prod 2026-10-22/);
    expect(sql).toMatch(/aldrig av en builder/);
    expect(sql).toContain('name: 059_user_boosts_window');
  });

  it('börjar med lock_timeout 5 s och har ingen egen transaktion', () => {
    expect(normalize(code).startsWith("set local lock_timeout = '5s';")).toBe(true);
    expect(code).not.toMatch(/\bbegin\s*;|\bcommit\b|\brollback\b/i);
  });

  it('förkontroll, kolumner, snapshot, backfyll och slutkontroll kommer i den ordningen', () => {
    const order = [at(/set local lock_timeout/i), at(/do \$preflight\$/i), at(/alter table public\.user_boosts/i), at(/do \$snapshot\$/i), at(/update public\.user_boosts b/i), at(/do \$postcheck\$/i)];
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('lägger till exakt de två kolumnerna, date, NULL-bara, utan default och med if not exists (idempotent)', () => {
    const alter = normalize(extract(/alter table public\.user_boosts[\s\S]*?;/i));
    expect(alter).toBe('alter table public.user_boosts add column if not exists start_date date, add column if not exists end_date date;');
    expect(code.match(/add column/gi)).toHaveLength(2);
    expect(alter).not.toMatch(/\bnot null\b|\bdefault\b/);
  });
});

describe('förkontrollen', () => {
  it('ändrar ingenting och stoppar på en saknad tabell, fel typ på created_at/expires_at och fel typ på de nya kolumnerna', () => {
    expect(preflight).not.toMatch(/\b(insert|update|delete|alter|drop|create)\b/);
    expect(preflight).toContain("to_regclass('public.user_boosts') is null");
    expect(preflight).toContain("array['created_at', 'expires_at']");
    expect(preflight).toContain("is distinct from 'timestamp with time zone'");
    expect(preflight).toContain("array['start_date', 'end_date']");
    expect(preflight).toContain("v_type <> 'date'");
  });
});

describe('backfyllet', () => {
  it('räknar UTC-dagen av created_at och expires_at, oberoende av sessionens tidszon', () => {
    expect(backfill).toContain("start_date = (b.created_at at time zone 'utc')::date");
    expect(backfill).toContain("end_date = (b.expires_at at time zone 'utc')::date");
  });

  it('rör bara rader utan fönster, så en körning till är idempotent och en ny boost med sparat fönster aldrig skrivs över', () => {
    expect(backfill).toMatch(/where b\.start_date is null;$/);
    expect(code.match(/\bupdate\s+public\./gi)).toHaveLength(1);
  });

  it('ändrar inte expires_at eller någon annan kolumn', () => {
    expect(backfill).not.toMatch(/expires_at\s*=|created_at\s*=|delta\s*=|remaining\s*=|type\s*=/);
  });
});

describe('snapshot och slutkontroll', () => {
  it('snapshotar raderna som ska backfyllas, alla övriga kolumner och RLS-läget i temporära tabeller som inte släpps vid commit', () => {
    expect(snapshot).toContain('create temp table mig059_todo as select id from public.user_boosts where start_date is null');
    expect(snapshot).toContain('create temp table mig059_before as select id, user_id, challenge_id, outcome, type, delta, remaining, expires_at, created_at from public.user_boosts');
    expect(snapshot).toContain('create temp table mig059_rls');
    expect(code).not.toMatch(/on commit drop/i);
  });

  it('kontrollerar kolumnerna, att ingen rad saknar fönster, att varje backfylld rad har UTC-dagarna (mot to_char, ett oberoende uttryck) och att end inte ligger före start', () => {
    expect(postcheck).toContain("'date' or v_nullable is distinct from 'yes'");
    expect(postcheck).toContain('where start_date is null');
    expect(postcheck).toContain("to_char(b.created_at at time zone 'utc', 'yyyy-mm-dd')::date");
    expect(postcheck).toContain("to_char(b.expires_at at time zone 'utc', 'yyyy-mm-dd')::date");
    expect(postcheck).toContain('b.end_date < b.start_date');
  });

  it('jämför alla övriga kolumner mot snapshoten med EXCEPT i båda riktningarna och kontrollerar RLS och policyer', () => {
    expect((postcheck.match(/\bexcept\b/g) ?? [])).toHaveLength(2);
    expect(postcheck).toContain('from mig059_before');
    expect(postcheck).toContain('relrowsecurity');
    expect(postcheck).toContain('pg_policy');
  });

  it('släpper snapshot-tabellerna sist, och inga andra tabeller', () => {
    expect([...code.matchAll(/\bdrop\s+table\s+(?:if\s+exists\s+)?(\S+)/gi)].map((m) => m[1]).filter((t) => !t.startsWith('pg_temp.'))).toEqual(['mig059_todo;', 'mig059_before;', 'mig059_rls;']);
  });
});

describe('inget annat än de två kolumnerna', () => {
  it('släpper ingenting med cascade, raderar och trunkerar ingenting, rör ingen policy, grant eller funktion', () => {
    expect(code).not.toMatch(/\bcascade\b|\btruncate\b|\bdelete\s+from\b|\binsert\s+into\b|\bcreate\s+policy\b|\bgrant\b|\brevoke\b|\bcreate\s+(or\s+replace\s+)?function\b|\bdrop\s+column\b/i);
  });
});

describe('rollback och frågor i headern', () => {
  it('rollbacken släpper bara de två kolumnerna, med if exists', () => {
    const rollback = headerBlock('ROLLBACK').split(/\r?\n/).filter((l) => l.startsWith('--   ')).map((l) => normalize(l.slice(5)));
    expect(rollback).toEqual(['alter table public.user_boosts drop column if exists end_date, drop column if exists start_date;']);
  });

  it('har katalogfrågor för kolumnerna, backfyllet, RLS och en ny boosts längd', () => {
    for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) headerBlock(q);
    expect(headerBlock('Q4')).toContain('end_date - start_date + 1');
  });

  it('säger att den körs före deployen av koden som läser kolumnerna, och att gamla boostar behåller sin XP', () => {
    expect(sql).toMatch(/FÖRE deployen av v0\.8\.1-koden/);
    expect(sql).toMatch(/BITIDENTISK XP/);
  });
});
