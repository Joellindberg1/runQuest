/**
 * Statiskt test: migration 045 lägger till Strava-identitet, samtycke och pausflagga på strava_tokens. Additiv och
 * idempotent, rör inga policyer, och headern + en egen rollback-fil anger hur den backas. Läser SQL-filerna från disk —
 * ingen databas.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, '../../../migrations');
const file = '045_strava_athlete_consent_pause.sql';
const sql = readFileSync(resolve(migrationsDir, file), 'utf8');
const rollbackSql = readFileSync(resolve(migrationsDir, 'rollback', '045_strava_athlete_consent_pause.rollback.sql'), 'utf8');

// Kommentarer bort så att rollback-SQL:en i headern inte räknas som körbar kod.
const strip = (s: string) => s.replace(/--.*$/gm, '');
const code = strip(sql);
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const statements = code.split(';').map(normalize).filter(Boolean);

describe(`migration ${file}`, () => {
  it('migration adds strava_athlete_id with a unique partial index', () => {
    expect(statements).toContain('alter table public.strava_tokens add column if not exists strava_athlete_id bigint');
    expect(statements).toContain(
      'create unique index if not exists strava_tokens_athlete_id_key on public.strava_tokens (strava_athlete_id) where strava_athlete_id is not null',
    );
    expect(code).not.toMatch(/\bconcurrently\b/i); // kan inte köras i apply_migrations transaktion
  });

  it('migration adds sync_paused as not null default false', () => {
    expect(statements).toContain('alter table public.strava_tokens add column if not exists sync_paused boolean not null default false');
    expect(statements).toContain('alter table public.strava_tokens add column if not exists paused_at timestamptz');
    expect(statements).toContain('alter table public.strava_tokens add column if not exists consent_version text');
    expect(statements).toContain('alter table public.strava_tokens add column if not exists consented_at timestamptz');
  });

  it('migration leaves strava_tokens without policies', () => {
    // Inga policyer, inga grants, ingen RLS-ändring: RLS-baslinjen (på, inga policyer) gäller oförändrad.
    expect(code).not.toMatch(/\b(policy|grant|revoke|row level security|disable|enable)\b/i);
    // Och allt som migrationen gör är fem kolumner + det enda indexet, på just strava_tokens — ingen annan SQL.
    expect(statements).toHaveLength(6);
    for (const s of statements) expect(s).toMatch(/\bpublic\.strava_tokens\b/);
  });

  it('is additive and idempotent: nothing is dropped, no data is written, no existing column changes', () => {
    expect(code).not.toMatch(/\b(drop|truncate|insert|update|delete|rename|trigger)\b/i);
    expect(code).not.toMatch(/\balter column\b/i);
    for (const s of statements.filter((x) => x.startsWith('alter table'))) expect(s).toMatch(/add column if not exists/);
    expect(statements.filter((x) => x.startsWith('create ')).every((x) => x.startsWith('create unique index if not exists'))).toBe(true);
  });

  it('header documents run order before deploy, application status and the rollback; the rollback file reverses it', () => {
    expect(sql).toMatch(/APPLICERAD/);
    expect(sql).toMatch(/KÖRORDNING: applicera DENNA migration FÖRE deploy/);
    expect(sql).toMatch(/Idempotent/);

    const headerRollback = sql.split('\n').filter((l) => /^--\s+(drop|alter)\b/i.test(l)).map((l) => normalize(l.replace(/^--\s*/, '')));
    const fileRollback = strip(rollbackSql).split(';').map(normalize).filter(Boolean);
    expect(headerRollback.map((l) => l.replace(/;$/, ''))).toEqual(fileRollback);
    expect(fileRollback[0]).toBe('drop index if exists public.strava_tokens_athlete_id_key'); // indexet först, sedan kolumnerna
    for (const col of ['strava_athlete_id', 'consent_version', 'consented_at', 'sync_paused', 'paused_at']) {
      expect(fileRollback.join(' ')).toMatch(new RegExp(`drop column if exists ${col}\\b`));
    }
  });
});
