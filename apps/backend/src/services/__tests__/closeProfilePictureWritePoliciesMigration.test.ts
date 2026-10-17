/**
 * Statiskt test: migration 051 tar bort policyerna på storage.objects (skriv och läs) och sätter bucketens gränser, och gör
 * inget annat. Gränserna måste vara samma som backendens uppladdning. Läser SQL-filen från disk, ingen databas.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED_IMAGE_TYPES, MAX_FILE_SIZE } from '../../routes/users.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(resolve(__dirname, '../../../migrations/051_close_profile_picture_write_policies.sql'), 'utf8');

// Kommentarer bort så att rollback-SQL:en i headern inte räknas som körbar kod.
const code = sql.replace(/--.*$/gm, '');
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

describe('migration 051_close_profile_picture_write_policies.sql', () => {
  it('tar bort policyer på storage.objects via pg_policies med drop policy if exists', () => {
    expect(code).toMatch(/from pg_policies\s+where schemaname = 'storage' and tablename = 'objects'/i);
    expect(normalize(code)).toContain("execute format('drop policy if exists %i on storage.objects', p.policyname)");
    expect(code.match(/drop\s+policy/gi)).toHaveLength(1);
  });

  it('rör inga andra tabeller än storage.objects och storage.buckets', () => {
    const relations = [...code.matchAll(/\b(?:storage|public|auth|extensions|pg_catalog|information_schema)\.[a-z_]+/gi)].map((m) => m[0].toLowerCase());
    expect(new Set(relations)).toEqual(new Set(['storage.objects', 'storage.buckets']));
    expect(code).not.toMatch(/\bpublic\./i);
    expect(code).not.toMatch(/\b(truncate|grant|revoke|alter|drop\s+table|delete\s+from)\b/i);
  });

  it('avbryter om en annan bucket finns eller om RLS är av, innan något tas bort', () => {
    const body = normalize(code);
    const dropAt = body.indexOf('drop policy');
    for (const guard of ["where id <> 'profile-pictures'", 'relrowsecurity']) {
      const at = body.indexOf(guard);
      expect(at, guard).toBeGreaterThan(-1);
      expect(at, guard).toBeLessThan(dropAt);
    }
    expect(code.match(/raise exception/gi)).toHaveLength(2);
  });

  it('sätter bucketens gräns och mime-typer lika med backendens uppladdning och lämnar public orörd vid konflikt', () => {
    const body = normalize(code);
    const mimeTypes = Object.keys(ALLOWED_IMAGE_TYPES).map((type) => `'${type}'`).join(', ');
    expect(body).toContain(`values ('profile-pictures', 'profile-pictures', true, ${MAX_FILE_SIZE}, array[${mimeTypes}])`);
    const conflict = body.slice(body.indexOf('on conflict'));
    expect(conflict).toContain('file_size_limit = excluded.file_size_limit');
    expect(conflict).toContain('allowed_mime_types = excluded.allowed_mime_types');
    expect(conflict).not.toContain('public');
  });

  it('headern har rollback för alla fyra policykommandon och för bucketens gränser samt underlag att spara före', () => {
    const header = sql.split('\n').filter((line) => line.startsWith('--')).join('\n');
    expect(header).toMatch(/Rollback/);
    for (const cmd of ['select', 'insert', 'update', 'delete']) {
      expect(header, cmd).toMatch(new RegExp(`--\\s+create policy "<sparat ${cmd.toUpperCase()}-namn>" on storage\\.objects for ${cmd}`, 'i'));
    }
    expect(header).toMatch(/--\s+update storage\.buckets set file_size_limit = null, allowed_mime_types = null/i);
    expect(header).toMatch(/Före applicering/);
    expect(header).toMatch(/select policyname, cmd, roles, qual, with_check from pg_policies/);
  });

  it('headern anger ägar-ja per miljö, motiv för SELECT-policyn och att migrationen inte körs av en builder', () => {
    expect(sql).toMatch(/ägar-ja/i);
    expect(sql).toMatch(/SELECT-policyn tas också bort/);
    expect(sql).toMatch(/Idempotent/);
  });
});
