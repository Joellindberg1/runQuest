/**
 * scripts/announceRelease.ts (RUN-161): dry-run som standard; --apply skriver en release_published-rad per grupp via
 * recordActivities; idempotent via dedupe_key; förkravet 041 kontrolleras före all skrivning; en saknad/ej annonserad
 * release stoppas innan databasen rörs. Körs mot fakeDb — shared-funktionerna är inte mockade.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { ACTIVITY_PAYLOAD_VERSION } from '@runquest/shared';
import {
  AnnouncePreconditionError,
  ReleaseSelectionError,
  findChangelogPath,
  formatReport,
  parseArgs,
  planAnnouncement,
  readChangelogReleases,
  runAnnounceRelease,
  selectRelease,
  type AnnounceReleaseOptions,
  type ChangelogRelease,
} from '../announceRelease.js';
import { createFakeDb, type FakeDbOptions, type RecordedQuery, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

const NOW = new Date('2026-10-12T08:00:00.000Z');

let errorSpy: ReturnType<typeof vi.spyOn>;
const originalUrl = process.env.SUPABASE_URL;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_URL = 'https://abcdef.supabase.co';
  errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  errorSpy.mockRestore();
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
});

// Nyaste först, som i changelog.json.
const RELEASES: ChangelogRelease[] = [
  { version: '0.6.1', title: 'News about releases', announce: true },
  { version: '0.6.0', title: 'Badges and weather titles', announce: true },
  { version: '0.5.3', title: 'Storm Chaser needs a real storm' },
];

function world(extra: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    groups: [
      { id: 'g-a', name: 'Alpha' },
      { id: 'g-b', name: 'Bravo' },
    ],
    activity_log: [],
    ...extra,
  };
}

type ProbeOutcome = { message: string; code?: string } | null;

/** Förkravstestinserten är den enda INSERT:en mot activity_log (live-skrivningen är en upsert). */
const isProbe = (q: RecordedQuery) => q.table === 'activity_log' && q.mutation === 'insert';

/** Standard: 041 finns, så testinserten stoppas av group-FK:n (23503). */
const FK_REJECT: ProbeOutcome = { message: 'insert violates foreign key constraint "activity_log_group_id_fkey"', code: '23503' };
const CHECK_REJECT: ProbeOutcome = { message: 'new row violates check constraint "activity_log_type_check"', code: '23514' };

function setup(tables: Record<string, Row[]> = world(), probe: ProbeOutcome = FK_REJECT, extra: FakeDbOptions['failWhen'] = () => null) {
  const options: FakeDbOptions = {
    numericIds: ['activity_log'],
    failWhen: (q) => (isProbe(q) ? probe : extra(q)),
  };
  const db = createFakeDb(tables, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return { db, tables };
}

const opts = (over: Partial<AnnounceReleaseOptions> = {}): AnnounceReleaseOptions => ({ apply: false, ...over });
const mutations = (db: ReturnType<typeof setup>['db']) => db.queries.filter((q) => q.mutation);
const releaseRows = (tables: Record<string, Row[]>) => tables.activity_log.filter((r) => r.type === 'release_published');

describe('parseArgs', () => {
  it('default: dry-run, senaste annonserade version', () => {
    expect(parseArgs([])).toEqual({ apply: false });
  });

  it('--apply och --version', () => {
    expect(parseArgs(['--apply', '--version=0.6.1'])).toEqual({ apply: true, version: '0.6.1' });
  });

  it('ogiltig version och okända argument stoppas', () => {
    expect(() => parseArgs(['--version='])).toThrow(/--version/);
    expect(() => parseArgs(['--version=v0.6.1'])).toThrow(/--version/);
    expect(() => parseArgs(['--version=0.6'])).toThrow(/--version/);
    expect(() => parseArgs(['--force'])).toThrow(/Unknown argument "--force"/);
  });
});

describe('selectRelease', () => {
  it('utan --version: den senaste posten med announce: true (hoppar över poster utan announce)', () => {
    expect(selectRelease(RELEASES).version).toBe('0.6.1');
    expect(selectRelease(RELEASES.slice(1)).version).toBe('0.6.0');
    expect(selectRelease([RELEASES[2], RELEASES[1]]).version).toBe('0.6.0');
  });

  it('"senaste" är högsta versionen, inte filens ordning', () => {
    expect(selectRelease([RELEASES[1], RELEASES[0]]).version).toBe('0.6.1');
    expect(selectRelease([{ version: '0.10.0', title: 'T', announce: true }, { version: '0.9.0', title: 'T', announce: true }]).version).toBe('0.10.0');
  });

  it('--version: måste finnas och vara annonserad', () => {
    expect(selectRelease(RELEASES, '0.6.0').title).toBe('Badges and weather titles');
    expect(() => selectRelease(RELEASES, '9.9.9')).toThrow(ReleaseSelectionError);
    expect(() => selectRelease(RELEASES, '9.9.9')).toThrow(/not in changelog\.json/);
    expect(() => selectRelease(RELEASES, '0.5.3')).toThrow(/no "announce": true/);
  });

  it('ingen announce-post alls: tydligt fel', () => {
    expect(() => selectRelease([RELEASES[2]])).toThrow(/No release in changelog\.json has "announce": true/);
    expect(() => selectRelease([])).toThrow(ReleaseSelectionError);
  });

  it('en trasig post (ogiltig version eller tom rubrik) kan inte väljas', () => {
    expect(() => selectRelease([{ version: 'abc', title: 'T', announce: true }])).toThrow(ReleaseSelectionError);
    expect(() => selectRelease([{ version: '1.0.0', title: '  ', announce: true }])).toThrow(ReleaseSelectionError);
  });
});

describe('changelog.json', () => {
  it('den riktiga filen hittas och läses (ordningen nyaste först, minst en annonserad post)', () => {
    const releases = readChangelogReleases(findChangelogPath());
    expect(releases.length).toBeGreaterThan(0);
    expect(selectRelease(releases).version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('findChangelogPath går uppåt till repo-roten och kastar tydligt om filen saknas', () => {
    const root = mkdtempSync(join(tmpdir(), 'announce-release-'));
    const nested = join(root, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    expect(() => findChangelogPath(nested)).toThrow(/Could not find apps\/frontend\/src\/data\/changelog\.json/);
    mkdirSync(join(root, 'apps', 'frontend', 'src', 'data'), { recursive: true });
    writeFileSync(join(root, 'apps', 'frontend', 'src', 'data', 'changelog.json'), JSON.stringify({ releases: [] }));
    expect(findChangelogPath(nested)).toBe(join(root, 'apps', 'frontend', 'src', 'data', 'changelog.json'));
  });

  it('en fil utan releases-lista ger ett tydligt fel', () => {
    const dir = mkdtempSync(join(tmpdir(), 'announce-release-'));
    const file = join(dir, 'changelog.json');
    writeFileSync(file, JSON.stringify({ features: [] }));
    expect(() => readChangelogReleases(file)).toThrow(/no "releases" array/);
  });
});

describe('planAnnouncement', () => {
  const groups = [{ id: 'g-a', name: 'Alpha' }, { id: 'g-b', name: 'Bravo' }];

  it('en draft per grupp utan raden; grupper med nyckeln hoppas över', () => {
    const plan = planAnnouncement(RELEASES[0], groups, new Set(['release_published:g-a:0.6.1']), NOW.toISOString());
    expect(plan.pending.map((g) => g.id)).toEqual(['g-b']);
    expect(plan.alreadyAnnounced.map((g) => g.id)).toEqual(['g-a']);
    expect(plan.drafts).toHaveLength(1);
  });

  it('nyckeln för en annan version räknas inte som redan annonserad', () => {
    const plan = planAnnouncement(RELEASES[0], groups, new Set(['release_published:g-a:0.6.0']), NOW.toISOString());
    expect(plan.pending).toHaveLength(2);
  });
});

describe('runAnnounceRelease — dry-run', () => {
  it('skriver ingenting och rör inte constrainten; rapporten listar grupperna och vald release', async () => {
    const { db, tables } = setup(world(), CHECK_REJECT);
    const before = JSON.stringify(tables);

    const report = await runAnnounceRelease(opts(), RELEASES, NOW);

    expect(JSON.stringify(tables)).toBe(before);
    expect(mutations(db)).toEqual([]);
    expect(report.release).toEqual({ version: '0.6.1', title: 'News about releases' });
    expect(report.target).toBe('abcdef.supabase.co');
    expect(report.totals).toEqual({ groups: 2, alreadyAnnounced: 0, planned: 2, written: 0 });
    expect(report.precondition).toBeNull();
    expect(report.failed).toBe(0);
    const text = formatReport(report);
    expect(text).toContain('DRY-RUN');
    expect(text).toContain('target database: abcdef.supabase.co');
    expect(text).toContain('v0.6.1 — News about releases');
    expect(text).toContain('Alpha [g-a]  would be written');
    expect(text).toContain('--apply');
  });
});

describe('runAnnounceRelease — --apply', () => {
  it('en rad per grupp: rätt nyckel, payload, actor null, target null, is_backfill false, payload_version', async () => {
    const { tables } = setup();
    const report = await runAnnounceRelease(opts({ apply: true }), RELEASES, NOW);

    const rows = releaseRows(tables);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.dedupe_key).sort()).toEqual(['release_published:g-a:0.6.1', 'release_published:g-b:0.6.1']);
    for (const row of rows) {
      expect(row).toMatchObject({
        type: 'release_published', actor_user_id: null, target_user_id: null, is_backfill: false,
        payload: { version: '0.6.1', title: 'News about releases' }, payload_version: ACTIVITY_PAYLOAD_VERSION,
        occurred_at: NOW.toISOString(),
      });
    }
    expect(rows.map((r) => r.group_id).sort()).toEqual(['g-a', 'g-b']);
    expect(report.totals).toEqual({ groups: 2, alreadyAnnounced: 0, planned: 2, written: 2 });
    expect(report.failed).toBe(0);
    expect(formatReport(report)).toContain('Wrote 2 of 2 release_published row(s)');
  });

  it('omkörning: 0 nya rader, inga skrivningar, rapporten säger att allt redan är annonserat', async () => {
    const { db, tables } = setup();
    await runAnnounceRelease(opts({ apply: true }), RELEASES, NOW);
    const before = JSON.stringify(tables);
    db.queries.length = 0;

    const report = await runAnnounceRelease(opts({ apply: true }), RELEASES, new Date('2026-10-13T08:00:00.000Z'));

    expect(JSON.stringify(tables)).toBe(before);
    expect(releaseRows(tables)).toHaveLength(2);
    expect(mutations(db).filter((q) => !isProbe(q))).toEqual([]);
    expect(report.totals).toEqual({ groups: 2, alreadyAnnounced: 2, planned: 0, written: 0 });
    expect(formatReport(report)).toContain('Nothing to write — all 2 group(s) already have v0.6.1 announced.');
  });

  it('en grupp som tillkommit efter första körningen får sin rad; de andra rörs inte', async () => {
    const { tables } = setup();
    await runAnnounceRelease(opts({ apply: true }), RELEASES, NOW);
    tables.groups.push({ id: 'g-c', name: 'Charlie' });

    const report = await runAnnounceRelease(opts({ apply: true }), RELEASES, NOW);

    expect(report.totals).toMatchObject({ planned: 1, alreadyAnnounced: 2, written: 1 });
    expect(releaseRows(tables).map((r) => r.group_id).sort()).toEqual(['g-a', 'g-b', 'g-c']);
  });

  it('--version väljer en äldre annonserad release (annan nyckel än den senaste)', async () => {
    const { tables } = setup();
    await runAnnounceRelease(opts({ apply: true }), RELEASES, NOW);
    await runAnnounceRelease(opts({ apply: true, version: '0.6.0' }), RELEASES, NOW);
    expect(releaseRows(tables).map((r) => r.dedupe_key).sort()).toEqual([
      'release_published:g-a:0.6.0', 'release_published:g-a:0.6.1', 'release_published:g-b:0.6.0', 'release_published:g-b:0.6.1',
    ]);
  });

  it('tom grupplista: inget skrivs och rapporten säger det', async () => {
    const { tables } = setup(world({ groups: [] }));
    const report = await runAnnounceRelease(opts({ apply: true }), RELEASES, NOW);
    expect(releaseRows(tables)).toEqual([]);
    expect(formatReport(report)).toContain('No groups found');
  });

  it('en skrivning som faller (recordActivities sväljer felet) räknas: failed > 0 och rapporten säger det', async () => {
    setup(world(), FK_REJECT, (q) => (q.table === 'activity_log' && q.mutation === 'upsert' ? { message: 'down' } : null));
    const report = await runAnnounceRelease(opts({ apply: true }), RELEASES, NOW);
    expect(report.totals.written).toBe(0);
    expect(report.failed).toBe(2);
    expect(formatReport(report)).toContain('FAILED');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('läsfel (grupper) stoppar körningen före skrivning', async () => {
    const { db } = setup(world(), FK_REJECT, (q) => (q.table === 'groups' ? { message: 'down' } : null));
    await expect(runAnnounceRelease(opts({ apply: true }), RELEASES, NOW)).rejects.toThrow(/Could not read groups/);
    expect(mutations(db).filter((q) => !isProbe(q))).toEqual([]);
  });
});

describe('förkrav 041', () => {
  it('041 saknas (activity_log_type_check avvisar release_published): tydligt avbrott, inget skrivet', async () => {
    const { db, tables } = setup(world(), CHECK_REJECT);
    const before = JSON.stringify(tables);

    await expect(runAnnounceRelease(opts({ apply: true }), RELEASES, NOW)).rejects.toThrow(AnnouncePreconditionError);
    await expect(runAnnounceRelease(opts({ apply: true }), RELEASES, NOW)).rejects.toThrow(/Migration 041 is not applied/);

    expect(JSON.stringify(tables)).toBe(before);
    // Det enda som försöktes var testinserten (avvisad); inga grupper lästes, inget upsertades.
    expect(mutations(db).every(isProbe)).toBe(true);
    expect(db.queries.some((q) => q.table === 'groups')).toBe(false);
  });

  it('känner igen avvisningen på constraintnamnet även utan felkod', async () => {
    setup(world(), { message: 'new row for relation "activity_log" violates check constraint "activity_log_type_check"' });
    await expect(runAnnounceRelease(opts({ apply: true }), RELEASES, NOW)).rejects.toThrow(/Migration 041 is not applied/);
  });

  it('ett oväntat fel kan inte verifieras: avbrott, inget skrivet', async () => {
    const { tables } = setup(world(), { message: 'connection reset', code: '08006' });
    const before = JSON.stringify(tables);
    await expect(runAnnounceRelease(opts({ apply: true }), RELEASES, NOW)).rejects.toThrow(/Could not verify migration 041/);
    expect(JSON.stringify(tables)).toBe(before);
  });

  it('041 finns: FK-avvisningen (23503) godkänner förkravet och rapporten säger det', async () => {
    setup(world(), FK_REJECT);
    const report = await runAnnounceRelease(opts({ apply: true }), RELEASES, NOW);
    expect(report.precondition).toMatch(/accepts release_published/);
    expect(formatReport(report)).toContain('migration 041: activity_log accepts release_published');
  });

  it('oväntat lyckad testinsert: testraden raderas direkt och förkravet godkänns', async () => {
    const { tables } = setup(world(), null);
    const report = await runAnnounceRelease(opts({ apply: true }), RELEASES, NOW);
    expect(report.precondition).toMatch(/removed again/);
    expect(tables.activity_log.some((r) => String(r.dedupe_key).startsWith('announce-release-probe:'))).toBe(false);
    expect(releaseRows(tables)).toHaveLength(2);
  });

  it('en testrad som inte kan tas bort: avbrott med nyckeln i meddelandet', async () => {
    setup(world(), null, (q) => (q.table === 'activity_log' && q.mutation === 'delete' ? { message: 'locked' } : null));
    await expect(runAnnounceRelease(opts({ apply: true }), RELEASES, NOW)).rejects.toThrow(/could not be removed \(dedupe_key announce-release-probe:/);
  });
});

describe('ingen release att annonsera', () => {
  it('ingen announce-post: tydligt fel och databasen rörs inte', async () => {
    const { db } = setup();
    await expect(runAnnounceRelease(opts({ apply: true }), [RELEASES[2]], NOW)).rejects.toThrow(ReleaseSelectionError);
    expect(db.queries).toEqual([]);
  });

  it('okänd --version: tydligt fel och databasen rörs inte', async () => {
    const { db } = setup();
    await expect(runAnnounceRelease(opts({ apply: true, version: '9.9.9' }), RELEASES, NOW)).rejects.toThrow(/not in changelog\.json/);
    expect(db.queries).toEqual([]);
  });

  it('--version utan announce: tydligt fel och databasen rörs inte', async () => {
    const { db } = setup();
    await expect(runAnnounceRelease(opts({ apply: true, version: '0.5.3' }), RELEASES, NOW)).rejects.toThrow(/no "announce": true/);
    expect(db.queries).toEqual([]);
  });
});
