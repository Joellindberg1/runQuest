/**
 * Indexnamnet som POST /api/runs letar efter i 23505-felet måste vara samma som migration 043 skapar — annars
 * skulle racet aldrig känna igen sin egen krock och svara 500 i stället för att återspela rundan.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../../config/database.js', () => ({ default: {}, supabase: { client: {} }, getSupabaseClient: vi.fn() }));

import { CLIENT_REQUEST_ID_INDEX } from '../../routes/runs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(resolve(__dirname, '../../../migrations/043_runs_client_request_id.sql'), 'utf8');
const code = sql.replace(/--.*$/gm, '');

describe('indexnamnet i runs.ts och migration 043', () => {
  it('create unique index i migrationen heter exakt som konstanten i koden', () => {
    const match = code.match(/create unique index if not exists\s+(\S+)\s+on public\.runs/i);
    expect(match, 'create unique index saknas i migrationen').not.toBeNull();
    expect(match![1]).toBe(CLIENT_REQUEST_ID_INDEX);
  });

  it('rollback-SQL:en i headern tar bort samma index', () => {
    expect(sql).toContain(`drop index if exists public.${CLIENT_REQUEST_ID_INDEX};`);
  });
});
