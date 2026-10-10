/**
 * Statiskt test (ADR 009 beslut 1): migration 035 skapar user_badges + users.displayed_badge_series
 * additivt, idempotent och utan anon-/authenticated-åtkomst. Läser SQL-filen från disk — ingen databas.
 * (Körning två gånger mot en riktig Postgres-motor bevisades separat med PGlite, se RUN-113-rapporten.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(resolve(__dirname, '../../../migrations/035_create_user_badges.sql'), 'utf8');
// Kommentarer bort så att exempel i headern inte räknas.
const code = sql.replace(/--.*$/gm, '');
// Själva create table-blocket (för kolumn-/constraint-asserts).
const tableBlock = code.match(/create table if not exists public\.user_badges\s*\(([\s\S]*?)\n\);/i)?.[1] ?? '';

describe('migration 035_create_user_badges.sql', () => {
  it('PK (user_id, series), seen_tier <= tier-CHECK, source_run_id on delete set null, user_id on delete cascade', () => {
    expect(tableBlock, 'create table-blocket hittades inte').not.toBe('');
    expect(tableBlock).toMatch(/primary key \(user_id, series\)/i);
    expect(tableBlock).toMatch(/user_id\s+uuid\s+not null references public\.users\(id\) on delete cascade/i);
    expect(tableBlock).toMatch(/series\s+text\s+not null/i);
    expect(tableBlock).toMatch(/tier\s+smallint\s+not null check \(tier >= 1\)/i);
    expect(tableBlock).toMatch(
      /seen_tier\s+smallint\s+not null default 0 check \(seen_tier >= 0 and seen_tier <= tier\)/i,
    );
    expect(tableBlock).toMatch(/earned_at\s+timestamptz\s+not null default now\(\)/i);
    expect(tableBlock).toMatch(/source_run_id\s+uuid\s+references public\.runs\(id\) on delete set null/i);
    expect(tableBlock).toMatch(/updated_at\s+timestamptz\s+not null default now\(\)/i);
    // Ingen CHECK på series: nya serier = ingen migration (ADR 009 beslut 1).
    expect(code).not.toMatch(/\bseries\s+text\b[^,\n]*check/i);
  });

  it('RLS på, ingen policy, revoke från anon/authenticated', () => {
    expect(code).toMatch(/alter table public\.user_badges enable row level security/i);
    expect(code).toMatch(/revoke all on public\.user_badges from anon, authenticated/i);
    expect(code).not.toMatch(/create policy/i);
    expect(code).not.toMatch(/\bgrant\b/i);
  });

  it("users.displayed_badge_series text[] not null default '{}' med cardinality <= 3", () => {
    expect(code).toMatch(
      /alter table public\.users add column if not exists displayed_badge_series text\[\] not null default '\{\}'/i,
    );
    expect(code).toMatch(
      /add constraint users_displayed_badge_series_max3 check \(cardinality\(displayed_badge_series\) <= 3\)/i,
    );
  });

  it('CHECK:en är idempotent: do-block som bara lägger constraint om den saknas', () => {
    const doBlock = code.match(/do \$\$([\s\S]*?)\$\$;/i)?.[1] ?? '';
    expect(doBlock, 'do-blocket hittades inte').not.toBe('');
    expect(doBlock).toMatch(/if not exists\s*\(\s*select 1 from pg_constraint/i);
    expect(doBlock).toMatch(/conname = 'users_displayed_badge_series_max3'/i);
    expect(doBlock).toMatch(/add constraint users_displayed_badge_series_max3/i);
    // Constraint:en får inte läggas till utanför do-blocket (då dör andra körningen).
    const outside = code.replace(doBlock, '');
    expect(outside).not.toMatch(/add constraint/i);
  });

  it('är additiv och idempotent: inga drop/rename/truncate/delete from; create/add med if not exists', () => {
    // "on delete cascade/set null" på FK:erna är tillåtet — här söks destruktiva satser.
    expect(code).not.toMatch(/\b(drop\s+\w+|rename\s+(to|column)|truncate|delete\s+from)\b/i);
    expect(code).not.toMatch(/create table (?!if not exists)/i);
    expect(code).not.toMatch(/add column (?!if not exists)/i);
  });
});
