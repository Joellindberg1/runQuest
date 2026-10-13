/**
 * Statiskt test (T1): migration 044 skapar waitlist_signups med unik normaliserad e-post, har RLS på utan policyer och
 * utan klientroller, är idempotent och anger körordning, status och rollback i headern. Läser SQL-filen från disk — ingen databas.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(resolve(__dirname, '../../../migrations/044_waitlist_signups.sql'), 'utf8');

// Kommentarer bort så att rollback-SQL:en i headern inte räknas som körbar kod.
const code = sql.replace(/--.*$/gm, '');
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const statements = code.split(';').map(normalize).filter(Boolean);

describe('T1 waitlist migration', () => {
  it('waitlist migration creates waitlist_signups with a unique normalized email', () => {
    const create = statements.find((s) => s.startsWith('create table if not exists public.waitlist_signups'));
    expect(create, 'create table saknas').toBeDefined();
    expect(create).toContain('id uuid primary key default gen_random_uuid()');
    expect(create).toContain('email text not null');
    expect(create).toContain('created_at timestamptz not null default now()');
    expect(create).toContain("source text not null default 'landing'");
    expect(create).toContain('consent_version text not null');
    // e-posten är normaliserad (trim + gemener) och högst 254 tecken — databasen vägrar annat än appen
    expect(create).toMatch(/check \(char_length\(email\) <= 254\)/);
    expect(create).toMatch(/check \(email = lower\(btrim\(email\)\)\)/);
    // ingen IP eller annat spårbart
    expect(create).not.toMatch(/\b(ip|ip_address|user_agent|referrer)\b/);
    expect(statements).toContain('create unique index if not exists waitlist_signups_email_key on public.waitlist_signups (email)');
  });

  it('waitlist migration enables RLS, has no policies and revokes anon and authenticated', () => {
    expect(statements).toContain('alter table public.waitlist_signups enable row level security');
    expect(statements).toContain('revoke all on public.waitlist_signups from anon, authenticated');
    expect(code).not.toMatch(/\b(create|alter|drop)\s+policy\b/i);
    expect(code).not.toMatch(/\bgrant\b/i);
    // ingen annan tabell rörs
    expect(code).not.toMatch(/\b(?:alter\s+table|insert\s+into|update|delete\s+from|drop\s+table)\s+(?!public\.waitlist_signups\b)\S+/i);
  });

  it('waitlist migration is idempotent and has run order and rollback in the header', () => {
    for (const s of statements.filter((x) => x.startsWith('create '))) expect(s).toContain('if not exists');
    expect(code).not.toMatch(/\b(drop|truncate)\b/i);
    expect(code).not.toMatch(/\b(begin|commit)\b/i); // apply_migration kör filen som en transaktion
    expect(code).not.toMatch(/\bconcurrently\b/i);
    // Applikationsstatus står i headern (EJ APPLICERAD före prod, APPLICERAD i prod efter).
    expect(sql).toMatch(/APPLICERAD/);
    expect(sql).toMatch(/KÖRORDNING: applicera DENNA migration FÖRE deploy/);
    expect(sql).toMatch(/Idempotent/);
    const rollback = sql.split('\n').filter((line) => /^--\s+drop\b/i.test(line)).map((line) => normalize(line.replace(/^--\s*/, '')));
    expect(rollback).toEqual(['drop table if exists public.waitlist_signups;']);
  });
});
