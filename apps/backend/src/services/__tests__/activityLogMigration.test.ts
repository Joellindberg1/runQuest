/**
 * Statiskt test (ADR 008 beslut 1): migration 034:s CHECK-lista för activity_log.type måste vara
 * identisk med ACTIVITY_TYPES i shared (EN källa i kod). Läser SQL-filen från disk — ingen databas.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIVITY_TYPES } from '@runquest/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(resolve(__dirname, '../../../migrations/034_create_activity_log.sql'), 'utf8');
// Kommentarer bort så att exempel i headern inte räknas.
const code = sql.replace(/--.*$/gm, '');

describe('migration 034_create_activity_log.sql', () => {
  it('CHECK-listan för type == ACTIVITY_TYPES (samma värden, samma antal)', () => {
    const match = code.match(/activity_log_type_check\s+check\s*\(\s*type\s+in\s*\(([^)]*)\)/i);
    expect(match, 'type-CHECK hittades inte').not.toBeNull();
    const values = [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...values].sort()).toEqual([...ACTIVITY_TYPES].sort());
    expect(new Set(values).size).toBe(values.length);
  });

  it('dedupe_key är not null + unik, id är monoton identitet', () => {
    expect(code).toMatch(/dedupe_key\s+text\s+not null/i);
    expect(code).toMatch(/constraint\s+activity_log_dedupe_key_key\s+unique\s*\(dedupe_key\)/i);
    expect(code).toMatch(/id\s+bigint\s+generated always as identity primary key/i);
  });

  it('RLS på, ingen policy, ingen anon-/authenticated-åtkomst (ADR 008 beslut 10)', () => {
    expect(code).toMatch(/alter table public\.activity_log enable row level security/i);
    expect(code).toMatch(/revoke all on public\.activity_log from anon, authenticated/i);
    expect(code).not.toMatch(/create policy/i);
  });

  it('is_backfill och keyset-index (group_id, id desc) finns; users.news_last_seen_id läggs additivt', () => {
    expect(code).toMatch(/is_backfill\s+boolean\s+not null default false/i);
    expect(code).toMatch(/activity_log_group_id_idx\s+on public\.activity_log \(group_id, id desc\)/i);
    expect(code).toMatch(/alter table public\.users add column if not exists news_last_seen_id bigint/i);
  });

  it('är additiv: inga drop/rename/delete', () => {
    expect(code).not.toMatch(/\b(drop|rename|truncate|delete)\b/i);
  });
});
