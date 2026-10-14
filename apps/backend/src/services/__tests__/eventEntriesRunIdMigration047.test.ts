/**
 * Statiskt test: migration 047 gör om FK:n event_entries.run_id till ON DELETE SET NULL (ADR 010 beslut 8.2 och 15, D2).
 * Läser SQL-filen från disk, ingen databas.
 *
 * Varför "run row deleted" bara läses och inte körs här: createFakeDb simulerar inga främmande nycklar (varken cascade,
 * set null eller no action), så ett test mot den skulle bevisa fakens egen kod, inte Postgres. Prod är förbjudet i den här
 * leveransen. Testet fäster därför det som gör beteendet: att FK:n heter som i baslinjen, att den pekar på runs(id) med
 * ON DELETE SET NULL, och att migrationen inte rör xp_awarded, users.event_xp eller entry-raderna. Beviset i en riktig
 * databas är en fråga mot pg_constraint efter apply (se migrationens header).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, '../../../migrations');
const file = '047_event_entries_run_id_set_null.sql';
const sql = readFileSync(resolve(migrationsDir, file), 'utf8');
const baseline = readFileSync(resolve(migrationsDir, '000_baseline.sql'), 'utf8');

// Kommentarer bort så att rollback-SQL:en i headern inte räknas som körbar kod.
const code = sql.replace(/--.*$/gm, '');
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const statements = code.split(';').map(normalize).filter(Boolean);

describe(`migration ${file}`, () => {
  it('migration recreates event_entries_run_id_fkey with ON DELETE SET NULL', () => {
    expect(statements).toEqual([
      'alter table public.event_entries drop constraint if exists event_entries_run_id_fkey',
      'alter table public.event_entries add constraint event_entries_run_id_fkey foreign key (run_id) references public.runs(id) on delete set null',
    ]);
    // Namnet och den gamla definitionen är de som baslinjen har, så drop-satsen träffar den verkliga FK:n.
    expect(normalize(baseline)).toContain(
      'alter table event_entries add constraint event_entries_run_id_fkey foreign key (run_id) references runs(id);',
    );
    // Kolumnen är redan nullable i baslinjen: ingen kolumnändring behövs.
    expect(baseline).toMatch(/create table public\.event_entries \([\s\S]*?\n\s+run_id uuid,\r?\n/);
  });

  it('deleting a run row leaves the event entry with run_id null and xp untouched', () => {
    // set null (inte cascade, inte no action): entry-raden överlever och bara run_id nollas.
    expect(statements[1]).toMatch(/\bon delete set null$/);
    expect(code).not.toMatch(/\bon delete cascade\b/i);
    // D2: xp_awarded, users.event_xp och entry-raderna rörs inte, varken som schema eller data.
    expect(code).not.toMatch(/xp_awarded|event_xp/i);
    expect(code).not.toMatch(/\b(insert|update|delete from|truncate|alter column|drop column|drop table|trigger|policy|grant|revoke)\b/i);
    // Allt migrationen gör är de två satserna på just event_entries.
    for (const s of statements) expect(s).toMatch(/^alter table public\.event_entries\b/);
  });

  it('is idempotent and has no transaction control of its own', () => {
    expect(statements[0]).toContain('drop constraint if exists');
    expect(code).not.toMatch(/\b(begin|commit|rollback)\b/i);
  });

  it('header has a commented rollback that restores the foreign key without ON DELETE', () => {
    const rollback = sql.split('\n').filter((l) => /^--\s+alter\b/i.test(l)).map((l) => normalize(l.replace(/^--\s*/, '')));
    expect(rollback).toEqual([
      'alter table public.event_entries drop constraint if exists event_entries_run_id_fkey;',
      'alter table public.event_entries add constraint event_entries_run_id_fkey foreign key (run_id) references public.runs(id);',
    ]);
  });
});
