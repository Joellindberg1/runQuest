/**
 * Statiskt test: migration 051 tar bort policyerna på storage.objects (skriv och läs) och sätter bucketens gränser, och gör
 * inget annat. Gränserna måste vara samma som backendens uppladdning. Läser SQL-filen från disk, ingen databas.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILE_PICTURE_MAX_BYTES, PROFILE_PICTURE_MIME_TYPES } from '@runquest/shared';

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

  it('avbryter om en annan bucket finns eller om RLS är av, innan något tas bort eller sätts', () => {
    const body = normalize(code);
    const firstChangeAt = Math.min(body.indexOf('drop policy'), body.indexOf('insert into storage.buckets'));
    for (const guard of ["where id <> 'profile-pictures'", 'relrowsecurity']) {
      const at = body.indexOf(guard);
      expect(at, guard).toBeGreaterThan(-1);
      expect(at, guard).toBeLessThan(firstChangeAt);
    }
    expect(code.match(/raise exception/gi)).toHaveLength(2);
  });

  it('lägger hela ändringen i ett enda do-block så att ett guard-fel aldrig lämnar en halv ändring', () => {
    const body = normalize(code);
    expect(body.startsWith('do $$ declare')).toBe(true);
    expect(body.endsWith('end $$;')).toBe(true);
    expect(code.match(/\$\$/g)).toHaveLength(2);
    // Bucketens upsert kommer efter policyloopen, inuti blocket.
    expect(body.indexOf('end loop')).toBeGreaterThan(-1);
    expect(body.indexOf('insert into storage.buckets')).toBeGreaterThan(body.indexOf('end loop'));
    expect(body.indexOf('insert into storage.buckets')).toBeLessThan(body.lastIndexOf('end $$;'));
  });

  it('sätter bucketens gräns och mime-typer lika med backendens uppladdning och lämnar public orörd vid konflikt', () => {
    const body = normalize(code);
    const mimeTypes = PROFILE_PICTURE_MIME_TYPES.map((type) => `'${type}'`).join(', ');
    expect(body).toContain(`values ('profile-pictures', 'profile-pictures', true, ${PROFILE_PICTURE_MAX_BYTES}, array[${mimeTypes}])`);
    const conflict = body.slice(body.indexOf('on conflict'));
    expect(conflict).toContain('file_size_limit = excluded.file_size_limit');
    expect(conflict).toContain('allowed_mime_types = excluded.allowed_mime_types');
    expect(conflict).not.toContain('public');
  });

  it('headern har rollback som återskapar prods fyra policyer med exakta namn och uttryck samt bucketens gränser', () => {
    const rollbackLines = sql.split(/\r?\n/).filter((line) => /^--\s+(create policy|update storage\.buckets)/.test(line)).map((line) => normalize(line.replace(/^--\s*/, '')));
    const own = "(bucket_id = 'profile-pictures'::text) and (auth.role() = 'authenticated'::text)";
    expect(rollbackLines).toEqual([
      `create policy "users can upload their own profile pictures" on storage.objects for insert to public with check (${own});`,
      `create policy "users can update their own profile pictures" on storage.objects for update to public using (${own});`,
      `create policy "users can delete their own profile pictures" on storage.objects for delete to public using (${own});`,
      `create policy "anyone can view profile pictures" on storage.objects for select to public using (bucket_id = 'profile-pictures'::text);`,
      "update storage.buckets set file_size_limit = null, allowed_mime_types = null where id = 'profile-pictures';",
    ]);
    expect(sql).not.toMatch(/<sparat/);
  });

  it('headern anger prods och stagings utgångsläge samt hur staging rullas tillbaka', () => {
    expect(sql).toMatch(/Rollback i prod/);
    expect(sql).toMatch(/Rollback i staging: staging saknade både policyer och bucket/);
    expect(sql).toMatch(/select policyname, cmd, roles, qual, with_check from pg_policies/);
  });

  it('headern anger ägar-ja per miljö, motiv för SELECT-policyn och att migrationen inte körs av en builder', () => {
    expect(sql).toMatch(/ägar-ja/i);
    expect(sql).toMatch(/SELECT-policyn tas också bort/);
    expect(sql).toMatch(/Idempotent/);
  });
});
