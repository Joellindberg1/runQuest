/**
 * Statiskt test: migration 043 lägger till runs.client_request_id och ett partiellt unikt index per användare, är
 * additiv och idempotent, och headern anger körordning, status och rollback. Läser SQL-filerna från disk — ingen databas.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, '../../../migrations');
const sql = readFileSync(resolve(migrationsDir, '043_runs_client_request_id.sql'), 'utf8');
const baseline = readFileSync(resolve(migrationsDir, '000_baseline.sql'), 'utf8');

// Kommentarer bort så att rollback-SQL:en i headern inte räknas som körbar kod.
const code = sql.replace(/--.*$/gm, '');

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

describe('migration 043_runs_client_request_id.sql', () => {
  it('innehåller exakt en idempotent add column och ett idempotent partiellt unikt index — ingen annan SQL', () => {
    const statements = code.split(';').map(normalize).filter(Boolean);
    expect(statements).toEqual([
      'alter table public.runs add column if not exists client_request_id uuid null',
      'create unique index if not exists runs_user_client_request_id_key on public.runs (user_id, client_request_id) where client_request_id is not null',
    ]);
  });

  it('är additiv: inget som tar bort, skriver data eller rör behörigheter', () => {
    expect(code).not.toMatch(/\b(drop|truncate|insert|update|delete|grant|revoke|policy|trigger)\b/i);
    expect(code).not.toMatch(/add column[^;]*\bnot\s+null\b/i); // kolumnen måste vara nullbar
    expect(code).not.toMatch(/\bdefault\b/i);
    expect(code).not.toMatch(/\bconcurrently\b/i); // kan inte köras i apply_migrations transaktion
  });

  it('refererar bara en befintlig tabell och befintliga kolumner i baslinjen (runs.user_id)', () => {
    const runsTable = baseline.match(/create table public\.runs \([\s\S]*?\n\);/i);
    expect(runsTable, 'runs-tabellen saknas i 000_baseline.sql').not.toBeNull();
    expect(runsTable![0]).toMatch(/\buser_id uuid not null\b/);
    expect(runsTable![0]).not.toMatch(/client_request_id/);
  });

  it('headern har rollback som tar bort index och kolumn, i den ordningen', () => {
    const rollback = sql.split('\n').filter((line) => /^--\s+(drop|alter)\b/i.test(line)).map((line) => normalize(line.replace(/^--\s*/, '')));
    expect(rollback).toEqual([
      'drop index if exists public.runs_user_client_request_id_key;',
      'alter table public.runs drop column if exists client_request_id;',
    ]);
  });

  it('headern anger körordning före deploy, status EJ APPLICERAD och att den är idempotent', () => {
    expect(sql).toMatch(/EJ APPLICERAD/);
    expect(sql).toMatch(/KÖRORDNING: applicera DENNA migration FÖRE deploy/);
    expect(sql).toMatch(/Idempotent/);
  });
});
