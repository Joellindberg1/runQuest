/**
 * Statiskt test: migration 046 skapar strava_webhook_events och claim_strava_webhook_events (ADR 010 beslut 5 och 6).
 * Läser SQL-filen från disk, ingen databas.
 *
 * Varför claim-funktionens beteende bara läses och inte körs här: låssemantik, FOR UPDATE SKIP LOCKED och READ COMMITTED
 * finns bara i Postgres, och prod är förbjudet i den här leveransen. En JS-modell av dem bevisar modellen, inte SQL:en
 * (samma resonemang som titleLeaderboardLockMigration.test.ts). Testerna nedan fäster därför kontraktets steg 1-3 i texten:
 * låset först, utgången lease ger attempts + 1, ägarurvalet utesluter ägare med processing-rad, urvalet är per ägare och
 * begränsat av p_max. Det som kräver en riktig databas står i migrationens header och bevisas av ett integrationstest mot
 * testmiljön (v0.8.0).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEBHOOK_STATUSES, WEBHOOK_OBJECT_TYPES, WEBHOOK_ASPECT_TYPES, WEBHOOK_UPDATE_KEYS } from '../stravaWebhook/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, '../../../migrations');
const file = '046_strava_webhook_events.sql';
const sql = readFileSync(resolve(migrationsDir, file), 'utf8');

// Kommentarer bort så att rollback-SQL:en i headern inte räknas som körbar kod.
const code = sql.replace(/--.*$/gm, '');
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
// Funktionskroppen innehåller semikolon, så den tas ut som en enhet och resten delas i satser.
const fnMatch = code.match(/create or replace function public\.claim_strava_webhook_events\([^)]*\)[\s\S]*?\$function\$;/i);
const fn = fnMatch?.[0] ?? '';
const body = fn.slice(fn.search(/\bbegin\b/i));
const statements = code.replace(fn, ' ').split(';').map(normalize).filter(Boolean);
const compactBody = normalize(body);

const listFrom = (source: string, pattern: RegExp): string[] => {
  const match = source.match(pattern);
  expect(match, `${pattern} hittades inte i ${file}`).not.toBeNull();
  return [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

describe(`migration ${file}`, () => {
  it('migration enables RLS and revokes anon and authenticated on strava_webhook_events', () => {
    expect(statements).toContain('alter table public.strava_webhook_events enable row level security');
    expect(statements).toContain('revoke all on public.strava_webhook_events from anon, authenticated');
    expect(code).not.toMatch(/\bcreate policy\b/i); // RLS på utan policyer: bara service role når tabellen
    expect(code).not.toMatch(/\bgrant\b[^;]*\bstrava_webhook_events\b/i);
  });

  it('claim function sets an empty search_path and revokes execute from public, anon and authenticated', () => {
    expect(fn).not.toBe('');
    expect(fn).toMatch(/\bset search_path to ''/i);
    expect(statements).toContain(
      'revoke execute on function public.claim_strava_webhook_events(integer, integer) from public, anon, authenticated',
    );
  });

  it('claim function is granted to service_role only', () => {
    const grants = statements.filter((s) => s.startsWith('grant '));
    expect(grants).toEqual(['grant execute on function public.claim_strava_webhook_events(integer, integer) to service_role']);
  });

  it('status list in code equals the migration CHECK list', () => {
    const fromMigration = listFrom(code, /\bstatus\s+text\b[^,]*?\bcheck\s*\(\s*status\s+in\s*\(([^)]*)\)/i);
    expect(fromMigration).toEqual([...WEBHOOK_STATUSES]);
    expect(new Set(fromMigration).size).toBe(fromMigration.length);
  });

  it('object_type, aspect_type and the updates key whitelist in code equal the migration', () => {
    expect(listFrom(code, /\bobject_type\s+text\b[^,]*?\bcheck\s*\(\s*object_type\s+in\s*\(([^)]*)\)/i)).toEqual([...WEBHOOK_OBJECT_TYPES]);
    expect(listFrom(code, /\baspect_type\s+text\b[^,]*?\bcheck\s*\(\s*aspect_type\s+in\s*\(([^)]*)\)/i)).toEqual([...WEBHOOK_ASPECT_TYPES]);
    expect(listFrom(code, /\(\s*updates\s*-\s*array\s*\[([^\]]*)\]/i)).toEqual([...WEBHOOK_UPDATE_KEYS]);
  });

  it('creates the table and the indexes as specified, idempotently', () => {
    const normalized = normalize(code);
    expect(statements.filter((s) => s.startsWith('create table'))).toHaveLength(1);
    expect(normalized).toMatch(/create table if not exists public\.strava_webhook_events/);
    expect(normalized).toMatch(/constraint strava_webhook_events_dedupe_key_key unique \(dedupe_key\)/);
    expect(normalized).toMatch(/user_id uuid references public\.users\(id\) on delete set null/);
    expect(statements).toContain(
      "create index if not exists strava_webhook_events_due_idx on public.strava_webhook_events (status, next_attempt_at) where status in ('pending','processing')",
    );
    expect(statements).toContain('create index if not exists strava_webhook_events_owner_idx on public.strava_webhook_events (owner_id, status)');
    expect(code).not.toMatch(/\bconcurrently\b/i); // kan inte köras i apply_migrations transaktion
  });

  it('header has a rollback that drops the function before the table, and the file runs no drop itself', () => {
    const rollback = sql.split('\n').filter((l) => /^--\s+drop\b/i.test(l)).map((l) => normalize(l.replace(/^--\s*/, '')));
    expect(rollback).toEqual([
      'drop function if exists public.claim_strava_webhook_events(integer, integer);',
      'drop table if exists public.strava_webhook_events;',
    ]);
    expect(code).not.toMatch(/\bdrop\b/i);
  });
});

describe('claim_strava_webhook_events contract (ADR 010 beslut 6, steg 1-3)', () => {
  const at = (re: RegExp) => compactBody.search(re);

  it('takes the advisory transaction lock as the very first statement', () => {
    const firstStatement = normalize(body.replace(/^begin\s*/i, '')).split(';')[0];
    expect(firstStatement).toBe("perform pg_advisory_xact_lock(hashtextextended('strava_webhook_events:claim', 0))");
    expect(code).not.toMatch(/pg_advisory_lock\(|pg_try_advisory/i); // xact-varianten släpps vid transaktionens slut
  });

  it('releases expired leases back to pending with attempts + 1 before it picks an owner', () => {
    const release = compactBody.match(
      /update public\.strava_webhook_events set ([^;]*?) where status = 'processing' and \(lease_expires_at is null or lease_expires_at <= now\(\)\);/,
    );
    expect(release, 'frisläppningen av utgångna leasar saknas').not.toBeNull();
    expect(release![1]).toMatch(/status = 'pending'/);
    expect(release![1]).toMatch(/attempts = attempts \+ 1/);
    expect(release![1]).toMatch(/claimed_at = null/);
    expect(release![1]).toMatch(/lease_expires_at = null/);
    expect(at(/update public\.strava_webhook_events set status = 'pending'/)).toBeLessThan(at(/select e\.owner_id into v_owner/));
  });

  it('picks the owner of the oldest due pending row among owners with no processing row', () => {
    const pick = compactBody.match(/select e\.owner_id into v_owner from public\.strava_webhook_events e where ([^;]*?) limit 1;/);
    expect(pick, 'ägarurvalet saknas').not.toBeNull();
    expect(pick![1]).toMatch(/e\.status = 'pending' and e\.next_attempt_at <= now\(\)/);
    expect(pick![1]).toMatch(
      /not exists \( select 1 from public\.strava_webhook_events p where p\.owner_id = e\.owner_id and p\.status = 'processing' \)/,
    );
    expect(pick![1]).toMatch(/order by e\.event_time, e\.id$/);
    expect(compactBody).toMatch(/if v_owner is null then return; end if;/);
  });

  it('claims up to p_max due rows for that owner only, with a lease of p_lease_seconds', () => {
    const claim = compactBody.match(
      /with due as \( select e\.id from public\.strava_webhook_events e where ([^;]*?) \), claimed as \( update public\.strava_webhook_events t set ([^;]*?) returning t\.\* \) select/,
    );
    expect(claim, 'claim-satsen saknas').not.toBeNull();
    const [, dueWhere, set] = claim!;
    expect(dueWhere).toMatch(/e\.owner_id = v_owner and e\.status = 'pending' and e\.next_attempt_at <= now\(\)/);
    expect(dueWhere).toMatch(/order by e\.event_time, e\.id limit p_max for update skip locked$/);
    expect(set).toMatch(/status = 'processing'/);
    expect(set).toMatch(/claimed_at = now\(\)/);
    expect(set).toMatch(/lease_expires_at = now\(\) \+ make_interval\(secs => p_lease_seconds\)/);
    expect(compactBody).toMatch(/from due where t\.id = due\.id/);
    // Svaret kommer i claim-ordning, inte i godtycklig UPDATE-ordning.
    expect(compactBody).toMatch(/select c\.\* from claimed c order by c\.event_time, c\.id;/);
  });

  it('rejects a null or non-positive p_max or p_lease_seconds instead of claiming everything (LIMIT NULL is no limit)', () => {
    expect(compactBody).toMatch(/if p_lease_seconds is null or p_lease_seconds <= 0 or p_max is null or p_max <= 0 then raise exception/);
    expect(at(/pg_advisory_xact_lock/)).toBeLessThan(at(/if p_lease_seconds is null/));
  });

  it('uses only schema-qualified relations, since the search_path is empty', () => {
    const relations = [...compactBody.matchAll(/\b(?:from|(?<!for )update|join|into)\s+([a-z_][a-z0-9_.]*)/g)]
      .map((m) => m[1])
      .filter((name) => name !== 'v_owner');
    expect(relations.length).toBeGreaterThan(0);
    for (const relation of relations) expect(['public.strava_webhook_events', 'due', 'claimed']).toContain(relation);
  });
});
