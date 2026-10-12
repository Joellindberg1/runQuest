/**
 * Statiskt test (RUN-112): migration 040 stänger anon-läsningen av level_requirements och gör inget annat, och
 * rollback-SQL:en i headern återskapar policyn exakt som i baslinjen. Läser SQL-filerna från disk — ingen databas.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, '../../../migrations');
const sql = readFileSync(resolve(migrationsDir, '040_close_level_requirements_anon_read.sql'), 'utf8');
const baseline = readFileSync(resolve(migrationsDir, '000_baseline.sql'), 'utf8');

// Kommentarer bort så att rollback-SQL:en i headern inte räknas som körbar kod.
const code = sql.replace(/--.*$/gm, '');

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

const POLICY = 'Anyone can view level requirements';

describe('migration 040_close_level_requirements_anon_read.sql', () => {
  it('innehåller exakt en drop policy (idempotent) på level_requirements och ingen annan DDL', () => {
    const statements = code.split(';').map(normalize).filter(Boolean);
    expect(statements).toEqual([`drop policy if exists "${POLICY.toLowerCase()}" on public.level_requirements`]);
    expect(code.match(/drop\s+policy/gi)).toHaveLength(1);
    expect(code).not.toMatch(/\b(truncate|alter|create|grant|revoke|insert|update|delete)\b/i);
  });

  it('headern har rollback som återskapar baslinjens policy exakt', () => {
    const baselinePolicy = baseline.split('\n').find((line) => line.includes(`"${POLICY}"`) && /^create policy/i.test(line));
    expect(baselinePolicy, 'policyn saknas i 000_baseline.sql').toBeDefined();
    const rollback = sql.split('\n').find((line) => /^--\s+create policy/i.test(line));
    expect(rollback, 'rollback-SQL saknas i headern').toBeDefined();
    expect(normalize(rollback!.replace(/^--\s*/, ''))).toBe(normalize(baselinePolicy!));
  });

  it('headern anger ägarbeslut, körordning och frontend-rollbackens konsekvens', () => {
    expect(sql).toMatch(/Ägarbeslut 2026-10-12/);
    expect(sql).toMatch(/Körordning/);
    expect(sql).toMatch(/frontend-rollback till v0\.5\.3/i);
  });
});
