/**
 * Statiskt test: migration 060 gör att databasen vägrar spara en Strava-token som inte är krypterad (ADR 013 beslut 8, S6). Läser SQL-filen
 * från disk, ingen databas.
 *
 * Beteendet körs inte här (staging och prod är förbjudna för en builder, och PGlite är inte ett beroende i repot). Testet fäster det som GÖR
 * beteendet: constrainten på varje tokenkolumn som stravaTokenStore skriver, ordningen not valid, validate, förkontrollen som räknar med count(*)
 * och aldrig läser ett värde, och slutkontrollens egna prov i migrationen (en tillfällig tabell med tabellens CHECK-villkor som får en klartexttoken
 * avvisad med check_violation), som körs i den riktiga motorn vid apply. Beviset i en riktig motor är builderns PGlite-körning (se slutrapporten).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StravaTokenColumn } from '../stravaTokenStore.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = '060_strava_tokens_encrypted_check.sql';
const sql = readFileSync(resolve(__dirname, '../../../migrations', file), 'utf8');
const storeSource = readFileSync(resolve(__dirname, '../stravaTokenStore.ts'), 'utf8');

const code = sql.replace(/--.*$/gm, '');
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const at = (re: RegExp) => code.search(re);
const extract = (re: RegExp): string => code.match(re)?.[0] ?? '';

const preflight = normalize(extract(/do \$preflight\$[\s\S]*?\$preflight\$;/i));
const snapshot = normalize(extract(/do \$snapshot\$[\s\S]*?\$snapshot\$;/i));
const postcheck = normalize(extract(/do \$postcheck\$[\s\S]*?\$postcheck\$;/i));
const addConstraint = normalize(extract(/alter table public\.strava_tokens\s+add constraint[\s\S]*?;/i));
const validate = normalize(extract(/alter table public\.strava_tokens\s+validate constraint[\s\S]*?;/i));

// The columns stravaTokenStore writes: listed here as a typed constant, so the compiler stops a column that the store type gains and this test does not know.
const TOKEN_COLUMNS: readonly StravaTokenColumn[] = ['access_token', 'refresh_token'];

function headerBlock(name: string): string {
  const start = sql.indexOf(`-- ${name}-START`);
  const end = sql.indexOf(`-- ${name}-END`);
  expect(start, `${name}-START saknas`).toBeGreaterThan(-1);
  expect(end, `${name}-END saknas`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe(`migration ${file}: form och ordning`, () => {
  it('anger var den är applicerad och säger att bara Lead applicerar den', () => {
    expect(sql).toMatch(/APPLICERAD i staging 2026-10-22 och i prod 2026-10-22/);
    expect(sql).toMatch(/aldrig av en builder/);
    expect(sql).toContain('name: 060_strava_tokens_encrypted_check');
  });

  it('börjar med lock_timeout 5 s och har ingen egen transaktion', () => {
    expect(normalize(code).startsWith("set local lock_timeout = '5s';")).toBe(true);
    expect(code).not.toMatch(/\bbegin\s*;|\bcommit\b|\brollback\b/i);
  });

  it('förkontroll, constraint not valid, validate, snapshot-fri slutkontroll kommer i den ordningen', () => {
    const order = [at(/set local lock_timeout/i), at(/do \$preflight\$/i), at(/do \$snapshot\$/i), at(/add constraint/i), at(/validate constraint/i), at(/do \$postcheck\$/i)];
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('constrainten', () => {
  it('gäller varje tokenkolumn som stravaTokenStore skriver, och tillåter null i var och en', () => {
    for (const column of TOKEN_COLUMNS) {
      expect(addConstraint, column).toContain(`(${column} is null or ${column} like 'enc:v1:%')`);
    }
    expect(storeSource).toContain("export type StravaTokenColumn = 'access_token' | 'refresh_token';");
    expect(addConstraint).toBe(
      "alter table public.strava_tokens add constraint strava_tokens_tokens_encrypted_chk check ((access_token is null or access_token like 'enc:v1:%') and (refresh_token is null or refresh_token like 'enc:v1:%')) not valid;",
    );
  });

  it('läggs som not valid och valideras i ett eget steg, båda utan några andra ändringar av tabellen', () => {
    expect(addConstraint).toMatch(/\) not valid;$/);
    expect(validate).toBe('alter table public.strava_tokens validate constraint strava_tokens_tokens_encrypted_chk;');
    expect(code.match(/\balter\s+table\b/gi)).toHaveLength(2);
  });

  it('har ingen annan skrivning än constrainten: ingen uppdatering, radering, kolumnändring, policy, grant eller funktion', () => {
    expect(code).not.toMatch(
      /\bupdate\s+public\.|\bdelete\s+from\b|\btruncate\b|\binsert\s+into\s+public\.|\bdrop\s+column\b|\bcascade\b|\bcreate\s+policy\b|\bgrant\b|\brevoke\b|\bcreate\s+(or\s+replace\s+)?function\b|\bdrop\s+constraint\b|\balter\s+column\b/i,
    );
  });
});

describe('förkontrollen', () => {
  it('ändrar ingenting och stoppar på en saknad tabell, fel kolumntyp, en constraint som redan finns', () => {
    expect(preflight).not.toMatch(/\b(insert|update|delete|alter|drop|create)\b/);
    expect(preflight).toContain("to_regclass('public.strava_tokens') is null");
    expect(preflight).toContain("array['access_token', 'refresh_token']");
    expect(preflight).toContain("is distinct from 'text'");
    expect(preflight).toContain("conname = 'strava_tokens_tokens_encrypted_chk'");
  });

  it('stoppar med ett tydligt fel om någon rad har klartext, och räknar med count(*) utan att läsa eller skriva ut ett värde', () => {
    expect(preflight).toContain('count(*)');
    expect(preflight).toContain("like 'enc:v1:%'");
    expect(preflight).toMatch(/raise exception '060 preflight: % rad/);
    expect(preflight).toContain('inget ändrat');
    // Ingen kolumn väljs ut i en variabel: bara antal. Meddelandet får inte ta emot något värde.
    for (const column of TOKEN_COLUMNS) {
      expect(preflight, column).not.toMatch(new RegExp(`select\\s+(?:[a-z_, ]*\\b)?${column}\\b(?![^;]*\\bcount\\()`));
    }
    expect(preflight).not.toMatch(/select\s+\*/);
    expect(preflight).not.toMatch(/\bstring_agg\b|\barray_agg\b|\bleft\(|\bsubstr/);
  });

  it('skiljer klartext per kolumn i antal och pekar på backfillskriptet', () => {
    expect(preflight).toMatch(/count\(\*\) filter \(where not \(access_token is null or access_token like 'enc:v1:%'\)\)/);
    expect(preflight).toMatch(/count\(\*\) filter \(where not \(refresh_token is null or refresh_token like 'enc:v1:%'\)\)/);
    expect(preflight).toContain('backfill:strava-token-encryption');
  });
});

describe('slutkontrollen', () => {
  it('kontrollerar att constrainten finns, är validerad och har rätt villkor', () => {
    expect(postcheck).toContain("conname = 'strava_tokens_tokens_encrypted_chk'");
    expect(postcheck).toContain('convalidated');
    expect(postcheck).toContain("v_type is distinct from 'c'");
    expect(postcheck).toContain('c.contype');
    expect(postcheck).toContain('pg_get_constraintdef');
    for (const column of TOKEN_COLUMNS) expect(postcheck, column).toContain(column);
    expect(postcheck).toContain('enc:v1:%');
  });

  it('räknar om rader som bryter villkoret med count(*) och jämför antalet rader och RLS-läget mot snapshoten', () => {
    expect(postcheck).toMatch(/select count\(\*\) into v_bad from public\.strava_tokens where not \(/);
    expect(snapshot).toContain('create temp table mig060_before');
    expect(snapshot).toContain('count(*)');
    expect(snapshot).toContain('relrowsecurity');
    expect(postcheck).toContain('from mig060_before');
    expect(postcheck).toContain('pg_policy');
    expect(code).not.toMatch(/on commit drop/i);
  });

  it('provar villkoret i motorn: en klartexttoken avvisas med check_violation, en krypterad och null godtas, på en tillfällig tabell och aldrig på riktiga rader', () => {
    expect(postcheck).toContain('create temp table mig060_probe (like public.strava_tokens including defaults including constraints)');
    expect(postcheck).toContain('exception when check_violation then');
    // Fyra klartextfall (båda kolumnerna, tomt värde och fel version) ska avvisas; två giltiga ska godtas. Avvisningen ska komma från just vår constraint.
    expect(postcheck).toContain('insert into pg_temp.mig060_probe (user_id, access_token, refresh_token)');
    expect(postcheck).toContain("'klartext i access_token'");
    expect(postcheck).toContain("'klartext i refresh_token'");
    expect(postcheck).toContain("'tomt värde i access_token'");
    expect(postcheck).toContain("'enc:v2:");
    expect(postcheck).toContain("'enc:v1:stg-1:aaaa:bbbb:cccc'");
    expect((postcheck.match(/, true\)/g) ?? []).length).toBe(4);
    expect((postcheck.match(/, false\)/g) ?? []).length).toBe(2);
    expect(postcheck).toContain("v_constraint is distinct from 'strava_tokens_tokens_encrypted_chk'");
    expect(postcheck).toContain('get stacked diagnostics v_constraint = constraint_name');
    // Proven kör mot den tillfälliga tabellen: ingen insert eller update mot public.
    expect(postcheck).not.toMatch(/\b(insert into|update|delete from)\s+public\./);
  });

  it('släpper snapshot- och provtabellerna sist, och inga andra tabeller', () => {
    const dropped = [...code.matchAll(/\bdrop\s+table\s+(?:if\s+exists\s+)?(\S+)/gi)].map((m) => m[1].replace(/;$/, ''));
    expect([...new Set(dropped)].sort()).toEqual(['pg_temp.mig060_before', 'pg_temp.mig060_probe']);
    expect(dropped.slice(-2)).toEqual(['pg_temp.mig060_probe', 'pg_temp.mig060_before']);
  });
});

describe('rollback, frågor och körordning i headern', () => {
  it('rollbacken släpper bara constrainten, med if exists', () => {
    const rollback = headerBlock('ROLLBACK').split(/\r?\n/).filter((l) => l.startsWith('--   ')).map((l) => normalize(l.slice(5)));
    expect(rollback).toEqual(['alter table public.strava_tokens drop constraint if exists strava_tokens_tokens_encrypted_chk;']);
  });

  it('har katalogfrågor för constrainten, antalet rader utanför villkoret, RLS och ett prov som inte rör riktiga rader', () => {
    for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) headerBlock(q);
    expect(headerBlock('Q1')).toContain('convalidated');
    expect(headerBlock('Q2')).toContain('count(*)');
    expect(headerBlock('Q4')).toContain('including constraints');
    // Ingen fråga i huvudet väljer ut ett tokenvärde: varje select är ett antal eller en katalogkolumn.
    for (const q of ['Q1', 'Q2', 'Q3']) {
      const lines = headerBlock(q).split(/\r?\n/).filter((l) => l.startsWith('--   ')).map((l) => l.slice(5));
      const query = normalize(lines.join(' '));
      expect(query, q).toMatch(/^select (count\(\*\)|conname|c\.relrowsecurity)/);
      expect(query, q).not.toMatch(/select [^()]*\b(access_token|refresh_token)\b[^()]* from/);
    }
  });

  it('säger ordningen: backfillen och noll klartextrader FÖRE migrationen, och koden som tar bort klartextläsningen EFTER', () => {
    expect(sql).toMatch(/backfill/i);
    expect(sql).toMatch(/plaintext_rows: 0/);
    expect(sql).toMatch(/EFTER 060/);
  });

  it('beskriver låsen och att nödutgången --decrypt vägras av databasen medan constrainten gäller', () => {
    expect(sql).toMatch(/ACCESS EXCLUSIVE/);
    expect(sql).toMatch(/SHARE UPDATE EXCLUSIVE/);
    expect(sql).toMatch(/--decrypt/);
    expect(sql).toMatch(/check_violation|23514/);
  });
});
