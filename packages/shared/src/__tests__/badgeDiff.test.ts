import { describe, it, expect } from 'vitest';
import { computeBadgeTiers, type BadgeTierResult } from '../badges.js';
import { diffBadgeTiers, type BadgeDiff, type ExistingBadgeRow } from '../badgeDiff.js';
import * as shared from '../index.js';

const NOW = new Date('2026-10-11T12:00:00.000Z');
const NOW_ISO = '2026-10-11T12:00:00.000Z';
const OLD = '2026-09-01T08:00:00.000Z';

function row(over: Partial<ExistingBadgeRow> = {}): ExistingBadgeRow {
  return { series: 'milestoner', tier: 1, seen_tier: 0, earned_at: OLD, source_run_id: null, ...over };
}

const tiers = (entries: Record<string, BadgeTierResult | number>): Record<string, BadgeTierResult> =>
  Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [key, typeof value === 'number' ? { tier: value } : value])
  );

const opts = { now: NOW };

function isEmpty(diff: BadgeDiff): boolean {
  return (
    diff.inserts.length === 0 &&
    diff.upgrades.length === 0 &&
    diff.downgrades.length === 0 &&
    diff.deletes.length === 0 &&
    diff.showcaseRemovals.length === 0
  );
}

/** Simulerar vad RUN-118 skriver, så att idempotensen kan provas mot ett riktigt "efter"-tillstånd. */
function applyDiff(existing: readonly ExistingBadgeRow[], diff: BadgeDiff): ExistingBadgeRow[] {
  const bySeries = new Map(existing.map((r) => [r.series, { ...r }]));
  for (const ins of diff.inserts) {
    bySeries.set(ins.series, {
      series: ins.series,
      tier: ins.tier,
      seen_tier: ins.seen_tier,
      earned_at: ins.earned_at,
      source_run_id: ins.source_run_id,
    });
  }
  for (const up of diff.upgrades) {
    bySeries.set(up.series, {
      series: up.series,
      tier: up.tier,
      seen_tier: up.seen_tier,
      earned_at: up.earned_at,
      source_run_id: up.source_run_id,
    });
  }
  for (const down of diff.downgrades) {
    const prev = bySeries.get(down.series)!;
    bySeries.set(down.series, {
      ...prev,
      tier: down.tier,
      seen_tier: down.seen_tier,
      source_run_id: down.source_run_id,
    });
  }
  for (const del of diff.deletes) bySeries.delete(del.series);
  return [...bySeries.values()];
}

describe('diffBadgeTiers — insert (T2)', () => {
  it('ny serie → insert med seen_tier 0', () => {
    const diff = diffBadgeTiers([], tiers({ milestoner: { tier: 2, source_run_id: 'r1' } }), opts);
    expect(diff.inserts).toEqual([
      {
        series: 'milestoner',
        tier: 2,
        seen_tier: 0,
        earned_at: NOW_ISO,
        source_run_id: 'r1',
        updated_at: NOW_ISO,
      },
    ]);
    expect(diff.upgrades).toEqual([]);
    expect(diff.downgrades).toEqual([]);
    expect(diff.deletes).toEqual([]);
    expect(diff.showcaseRemovals).toEqual([]);
  });

  it('markSeen sätter seen_tier = tier vid insert', () => {
    const diff = diffBadgeTiers([], tiers({ earth_trotter: 3 }), { ...opts, markSeen: true });
    expect(diff.inserts).toHaveLength(1);
    expect(diff.inserts[0].seen_tier).toBe(3);
    expect(diff.inserts[0].tier).toBe(3);
  });

  it('source_run_id blir null när serien saknar enrundskälla', () => {
    const diff = diffBadgeTiers([], tiers({ earth_trotter: 1 }), opts);
    expect(diff.inserts[0].source_run_id).toBeNull();
  });

  it('ny serie med tier 0 ger ingen post', () => {
    expect(isEmpty(diffBadgeTiers([], tiers({ milestoner: 0 }), opts))).toBe(true);
  });
});

describe('diffBadgeTiers — upgrade (T3)', () => {
  it('uppgradering 2→4 lämnar seen_tier', () => {
    const diff = diffBadgeTiers(
      [row({ tier: 2, seen_tier: 2, source_run_id: 'old-run' })],
      tiers({ milestoner: { tier: 4, source_run_id: 'new-run' } }),
      opts
    );
    expect(diff.upgrades).toEqual([
      {
        series: 'milestoner',
        tier: 4,
        previous_tier: 2,
        seen_tier: 2,
        earned_at: NOW_ISO,
        source_run_id: 'new-run',
        updated_at: NOW_ISO,
      },
    ]);
    expect(diff.inserts).toEqual([]);
    expect(diff.downgrades).toEqual([]);
    expect(diff.deletes).toEqual([]);
  });

  it('uppgradering lämnar en lägre seen_tier orörd (ej sedd popup bevaras)', () => {
    const diff = diffBadgeTiers([row({ tier: 2, seen_tier: 1 })], tiers({ milestoner: 3 }), opts);
    expect(diff.upgrades[0].seen_tier).toBe(1);
  });

  it('markSeen sätter seen_tier = tier vid uppgradering', () => {
    const diff = diffBadgeTiers([row({ tier: 2, seen_tier: 1 })], tiers({ milestoner: 5 }), {
      ...opts,
      markSeen: true,
    });
    expect(diff.upgrades[0].seen_tier).toBe(5);
  });

  it('earned_at sätts till injicerad now (ISO-sträng)', () => {
    const diff = diffBadgeTiers([row({ tier: 1 })], tiers({ milestoner: 2 }), {
      now: new Date('2027-01-02T03:04:05.678Z'),
    });
    expect(diff.upgrades[0].earned_at).toBe('2027-01-02T03:04:05.678Z');
    expect(diff.upgrades[0].updated_at).toBe('2027-01-02T03:04:05.678Z');
  });

  it('utan opts.now används systemklockan', () => {
    const before = Date.now();
    const diff = diffBadgeTiers([], tiers({ milestoner: 1 }));
    const stamped = Date.parse(diff.inserts[0].updated_at);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(Date.now());
    expect(diff.inserts[0].earned_at).toBe(diff.inserts[0].updated_at);
  });
});

describe('diffBadgeTiers — downgrade (T4)', () => {
  it('nedgradering 4→2 med seen 4 → seen 2', () => {
    const diff = diffBadgeTiers([row({ tier: 4, seen_tier: 4 })], tiers({ milestoner: 2 }), opts);
    expect(diff.downgrades).toHaveLength(1);
    expect(diff.downgrades[0]).toMatchObject({
      series: 'milestoner',
      tier: 2,
      previous_tier: 4,
      seen_tier: 2,
      updated_at: NOW_ISO,
    });
  });

  it('nedgradering 4→2 med seen 1 → seen 1', () => {
    const diff = diffBadgeTiers([row({ tier: 4, seen_tier: 1 })], tiers({ milestoner: 2 }), opts);
    expect(diff.downgrades[0].seen_tier).toBe(1);
  });

  it('earned_at rörs inte: posten bär inget earned_at-fält', () => {
    const diff = diffBadgeTiers([row({ tier: 4, seen_tier: 4, earned_at: OLD })], tiers({ milestoner: 2 }), opts);
    expect('earned_at' in diff.downgrades[0]).toBe(false);
    expect(applyDiff([row({ tier: 4, seen_tier: 4, earned_at: OLD })], diff)[0].earned_at).toBe(OLD);
  });

  it('markSeen ändrar inte seen_tier vid nedgradering (bara least)', () => {
    const diff = diffBadgeTiers([row({ tier: 4, seen_tier: 1 })], tiers({ milestoner: 2 }), {
      ...opts,
      markSeen: true,
    });
    expect(diff.downgrades[0].seen_tier).toBe(1);
  });

  it('source_run_id följer den nya tiern', () => {
    const diff = diffBadgeTiers(
      [row({ tier: 4, seen_tier: 4, source_run_id: 'big' })],
      tiers({ milestoner: { tier: 3, source_run_id: 'smaller' } }),
      opts
    );
    expect(diff.downgrades[0].source_run_id).toBe('smaller');
  });

  it('nedgradering till tier ≥ 1 rensar inte showcase', () => {
    const diff = diffBadgeTiers([row({ tier: 4, seen_tier: 4 })], tiers({ milestoner: 1 }), opts);
    expect(diff.showcaseRemovals).toEqual([]);
  });

  it('seen_tier <= tier gäller för varje nedgradering (invariant)', () => {
    for (let tier = 2; tier <= 6; tier++) {
      for (let seen = 0; seen <= tier; seen++) {
        for (let next = 1; next < tier; next++) {
          const [down] = diffBadgeTiers([row({ tier, seen_tier: seen })], tiers({ milestoner: next }), opts)
            .downgrades;
          expect(down.seen_tier).toBe(Math.min(seen, next));
          expect(down.seen_tier).toBeLessThanOrEqual(down.tier);
        }
      }
    }
  });
});

describe('diffBadgeTiers — delete (T5)', () => {
  it('tier 0 → delete + showcaseRemovals', () => {
    const diff = diffBadgeTiers([row({ series: 'night_owl', tier: 3, seen_tier: 3 })], tiers({ night_owl: 0 }), opts);
    expect(diff.deletes).toEqual([{ series: 'night_owl', previous_tier: 3 }]);
    expect(diff.showcaseRemovals).toEqual(['night_owl']);
    expect(diff.inserts).toEqual([]);
    expect(diff.upgrades).toEqual([]);
    expect(diff.downgrades).toEqual([]);
  });

  it('flera serier: varje raderad serie hamnar i showcaseRemovals, bevarad ordning', () => {
    const diff = diffBadgeTiers(
      [row({ series: 'early_bird', tier: 2 }), row({ series: 'speedster', tier: 1 }), row({ series: 'climber', tier: 1 })],
      tiers({ early_bird: 0, speedster: 0, climber: 1 }),
      opts
    );
    expect(diff.deletes.map((d) => d.series)).toEqual(['early_bird', 'speedster']);
    expect(diff.showcaseRemovals).toEqual(['early_bird', 'speedster']);
  });
});

describe('diffBadgeTiers — oförändrat och okänt (T6)', () => {
  it('oförändrad (även ändrad source_run_id) → tom diff', () => {
    const diff = diffBadgeTiers(
      [row({ tier: 3, seen_tier: 1, source_run_id: 'run-a' })],
      tiers({ milestoner: { tier: 3, source_run_id: 'run-b' } }),
      opts
    );
    expect(isEmpty(diff)).toBe(true);
  });

  it('oförändrad där DB har source_run_id men beräkningen saknar den → tom diff', () => {
    const diff = diffBadgeTiers([row({ tier: 3, source_run_id: 'run-a' })], tiers({ milestoner: 3 }), opts);
    expect(isEmpty(diff)).toBe(true);
  });

  it('okänd serie ignoreras', () => {
    const diff = diffBadgeTiers(
      [row({ series: 'socialite', tier: 2, seen_tier: 2 }), row({ series: 'milestoner', tier: 1 })],
      tiers({ milestoner: 1 }),
      opts
    );
    expect(isEmpty(diff)).toBe(true);
  });

  it('okänd serie i DB rörs aldrig (inte raderad, inte i showcaseRemovals)', () => {
    const diff = diffBadgeTiers([row({ series: 'socialite', tier: 2, seen_tier: 2 })], tiers({ milestoner: 2 }), opts);
    expect(diff.deletes).toEqual([]);
    expect(diff.showcaseRemovals).toEqual([]);
    expect(diff.inserts.map((i) => i.series)).toEqual(['milestoner']);
  });
});

describe('diffBadgeTiers — kombinationer och robusthet (T1)', () => {
  it('alla fem sorters poster i samma körning', () => {
    const existing = [
      row({ series: 'milestoner', tier: 1, seen_tier: 1 }), // upgrade
      row({ series: 'earth_trotter', tier: 4, seen_tier: 4 }), // downgrade
      row({ series: 'climber', tier: 2, seen_tier: 2 }), // delete
      row({ series: 'streak_keeper', tier: 3, seen_tier: 0 }), // oförändrad
    ];
    const diff = diffBadgeTiers(
      existing,
      tiers({ milestoner: 2, earth_trotter: 2, climber: 0, streak_keeper: 3, early_bird: 1 }),
      opts
    );
    expect(diff.upgrades.map((u) => u.series)).toEqual(['milestoner']);
    expect(diff.downgrades.map((d) => d.series)).toEqual(['earth_trotter']);
    expect(diff.deletes.map((d) => d.series)).toEqual(['climber']);
    expect(diff.inserts.map((i) => i.series)).toEqual(['early_bird']);
    expect(diff.showcaseRemovals).toEqual(['climber']);
  });

  it('varje insert/upgrade/downgrade bär updated_at = now (tabellen saknar trigger)', () => {
    const diff = diffBadgeTiers(
      [row({ series: 'milestoner', tier: 1 }), row({ series: 'earth_trotter', tier: 4, seen_tier: 4 })],
      tiers({ milestoner: 2, earth_trotter: 2, early_bird: 1 }),
      opts
    );
    for (const post of [...diff.inserts, ...diff.upgrades, ...diff.downgrades]) {
      expect(post.updated_at).toBe(NOW_ISO);
    }
  });

  it('muterar inte indata (existing, computed eller now)', () => {
    const existing = Object.freeze([
      Object.freeze(row({ series: 'milestoner', tier: 4, seen_tier: 4 })),
      Object.freeze(row({ series: 'climber', tier: 2, seen_tier: 1 })),
    ]);
    const computed = Object.freeze({
      milestoner: Object.freeze({ tier: 2, source_run_id: 'r' }),
      climber: Object.freeze({ tier: 0 }),
      early_bird: Object.freeze({ tier: 1 }),
    });
    const snapshotExisting = JSON.stringify(existing);
    const snapshotComputed = JSON.stringify(computed);
    const now = new Date(NOW.getTime());
    expect(() => diffBadgeTiers(existing, computed, { now, markSeen: true })).not.toThrow();
    expect(JSON.stringify(existing)).toBe(snapshotExisting);
    expect(JSON.stringify(computed)).toBe(snapshotComputed);
    expect(now.getTime()).toBe(NOW.getTime());
  });

  it('postobjekten delar inga referenser med indata', () => {
    const existing = [row({ tier: 1 })];
    const diff = diffBadgeTiers(existing, tiers({ milestoner: 2 }), opts);
    diff.upgrades[0].seen_tier = 99;
    expect(existing[0].seen_tier).toBe(0);
  });

  it('tar emot computeBadgeTiers-utdata direkt', () => {
    const computed = computeBadgeTiers(
      [
        {
          id: 'big',
          date: '2026-10-01',
          distance_km: 22,
          start_time: null,
          moving_time: null,
          total_elevation_gain: null,
          is_treadmill: false,
        },
      ],
      { longest_streak: 0 }
    );
    const diff = diffBadgeTiers([], computed, opts);
    const milestoner = diff.inserts.find((i) => i.series === 'milestoner');
    expect(milestoner).toMatchObject({ tier: 3, source_run_id: 'big', seen_tier: 0 });
    expect(diff.inserts.map((i) => i.series)).not.toContain('night_owl');
  });

  it('ogiltiga tiervärden hanteras defensivt: NaN/negativt = 0, över MAX_TIER klampas till 6', () => {
    const diff = diffBadgeTiers(
      [row({ series: 'climber', tier: 2, seen_tier: 2 })],
      tiers({ climber: Number.NaN, milestoner: 9, earth_trotter: -1 }),
      opts
    );
    expect(diff.deletes).toEqual([{ series: 'climber', previous_tier: 2 }]);
    expect(diff.inserts.map((i) => [i.series, i.tier])).toEqual([['milestoner', 6]]);
  });

  it('exporteras från paketets index', () => {
    expect(typeof shared.diffBadgeTiers).toBe('function');
  });
});

describe('diffBadgeTiers — idempotens (T7)', () => {
  const scenarios: Array<{ name: string; existing: ExistingBadgeRow[]; computed: Record<string, BadgeTierResult> }> = [
    { name: 'ny serie', existing: [], computed: tiers({ milestoner: { tier: 3, source_run_id: 'r' } }) },
    {
      name: 'uppgradering',
      existing: [row({ tier: 1, seen_tier: 1 })],
      computed: tiers({ milestoner: { tier: 4, source_run_id: 'r' } }),
    },
    {
      name: 'nedgradering',
      existing: [row({ tier: 5, seen_tier: 5, source_run_id: 'x' })],
      computed: tiers({ milestoner: { tier: 2, source_run_id: 'y' } }),
    },
    { name: 'radering', existing: [row({ tier: 2, seen_tier: 2 })], computed: tiers({ milestoner: 0 }) },
    {
      name: 'blandat med okänd serie',
      existing: [
        row({ series: 'milestoner', tier: 1 }),
        row({ series: 'climber', tier: 4, seen_tier: 3 }),
        row({ series: 'night_owl', tier: 2 }),
        row({ series: 'socialite', tier: 2 }),
      ],
      computed: tiers({ milestoner: 3, climber: 1, night_owl: 0, early_bird: 2 }),
    },
  ];

  for (const markSeen of [false, true]) {
    for (const scenario of scenarios) {
      it(`omkörning på resultatet av en körning ger tom diff — ${scenario.name}${markSeen ? ' (markSeen)' : ''}`, () => {
        const first = diffBadgeTiers(scenario.existing, scenario.computed, { now: NOW, markSeen });
        const after = applyDiff(scenario.existing, first);
        const second = diffBadgeTiers(after, scenario.computed, { now: new Date('2030-01-01T00:00:00Z'), markSeen });
        expect(isEmpty(second)).toBe(true);
      });
    }
  }
});
