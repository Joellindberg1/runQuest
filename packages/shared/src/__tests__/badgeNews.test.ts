import { describe, it, expect } from 'vitest';
import { badgeNewsChanges } from '../badgeNews.js';
import { activityKeys } from '../activity.js';
import type { BadgeDiff } from '../badgeDiff.js';
import * as shared from '../index.js';

const AT = '2026-10-11T12:00:00.000Z';
const ctx = { userId: 'u1', groupId: 'g1', occurredAt: AT };

const empty = (): BadgeDiff => ({ inserts: [], upgrades: [], downgrades: [], deletes: [], showcaseRemovals: [] });

const insert = (series: string, tier: number) => ({
  series, tier, seen_tier: 0, earned_at: AT, source_run_id: null, updated_at: AT,
});
const upgrade = (series: string, tier: number, previous_tier: number) => ({
  series, tier, previous_tier, seen_tier: 0, earned_at: AT, source_run_id: null, updated_at: AT,
});
const downgrade = (series: string, tier: number, previous_tier: number) => ({
  series, tier, previous_tier, seen_tier: 0, source_run_id: null, updated_at: AT,
});

describe('badgeNewsChanges', () => {
  it('tom diff: inga drafts och inga nycklar', () => {
    expect(badgeNewsChanges(empty(), ctx)).toEqual({ drafts: [], retractKeys: [] });
  });

  it('insert: en badge_earned med previous_tier null, aktör användaren, gruppen och nyckeln', () => {
    const { drafts, retractKeys } = badgeNewsChanges({ ...empty(), inserts: [insert('milestoner', 1)] }, ctx);
    expect(retractKeys).toEqual([]);
    expect(drafts).toEqual([{
      type: 'badge_earned', group_id: 'g1', actor_user_id: 'u1', target_user_id: null,
      payload: { series: 'milestoner', tier: 1, previous_tier: null }, payload_version: 1,
      dedupe_key: activityKeys.badgeEarned('u1', 'milestoner', 1), occurred_at: AT, is_backfill: false,
    }]);
  });

  it('insert som landar direkt på tier 3: EN rad (landningstiern), inte tre', () => {
    const { drafts } = badgeNewsChanges({ ...empty(), inserts: [insert('earth_trotter', 3)] }, ctx);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].payload).toEqual({ series: 'earth_trotter', tier: 3, previous_tier: null });
  });

  it('uppgradering 1→3: EN rad för tier 3 med previous_tier 1', () => {
    const { drafts, retractKeys } = badgeNewsChanges({ ...empty(), upgrades: [upgrade('milestoner', 3, 1)] }, ctx);
    expect(retractKeys).toEqual([]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].payload).toEqual({ series: 'milestoner', tier: 3, previous_tier: 1 });
    expect(drafts[0].dedupe_key).toBe(activityKeys.badgeEarned('u1', 'milestoner', 3));
  });

  it('flera serier: en rad per serie, inserts före upgrades', () => {
    const { drafts } = badgeNewsChanges(
      { ...empty(), inserts: [insert('a', 1), insert('b', 2)], upgrades: [upgrade('c', 4, 3)] },
      ctx,
    );
    expect(drafts.map((d) => d.payload)).toEqual([
      { series: 'a', tier: 1, previous_tier: null },
      { series: 'b', tier: 2, previous_tier: null },
      { series: 'c', tier: 4, previous_tier: 3 },
    ]);
  });

  it('nedgradering 3→1: nycklarna för tier 2 och 3 retractas, ingen draft', () => {
    const { drafts, retractKeys } = badgeNewsChanges({ ...empty(), downgrades: [downgrade('milestoner', 1, 3)] }, ctx);
    expect(drafts).toEqual([]);
    expect(retractKeys).toEqual([
      activityKeys.badgeEarned('u1', 'milestoner', 2),
      activityKeys.badgeEarned('u1', 'milestoner', 3),
    ]);
  });

  it('nedgradering 2→1: bara tier 2 retractas (tier 1 står kvar)', () => {
    const { retractKeys } = badgeNewsChanges({ ...empty(), downgrades: [downgrade('milestoner', 1, 2)] }, ctx);
    expect(retractKeys).toEqual([activityKeys.badgeEarned('u1', 'milestoner', 2)]);
  });

  it('radering från tier 3: tier 1, 2 och 3 retractas', () => {
    const { drafts, retractKeys } = badgeNewsChanges(
      { ...empty(), deletes: [{ series: 'milestoner', previous_tier: 3 }], showcaseRemovals: ['milestoner'] },
      ctx,
    );
    expect(drafts).toEqual([]);
    expect(retractKeys).toEqual([1, 2, 3].map((t) => activityKeys.badgeEarned('u1', 'milestoner', t)));
  });

  it('blandad diff ger både drafts och nycklar', () => {
    const { drafts, retractKeys } = badgeNewsChanges(
      {
        ...empty(),
        inserts: [insert('a', 1)],
        downgrades: [downgrade('b', 1, 2)],
        deletes: [{ series: 'c', previous_tier: 1 }],
      },
      ctx,
    );
    expect(drafts).toHaveLength(1);
    expect(retractKeys).toEqual([
      activityKeys.badgeEarned('u1', 'b', 2),
      activityKeys.badgeEarned('u1', 'c', 1),
    ]);
  });

  it('utan grupp: inga drafts, men nycklar att retracta finns kvar (raderna är nyckelstyrda)', () => {
    const diff: BadgeDiff = {
      ...empty(), inserts: [insert('a', 1)], upgrades: [upgrade('b', 2, 1)], deletes: [{ series: 'c', previous_tier: 2 }],
    };
    const { drafts, retractKeys } = badgeNewsChanges(diff, { ...ctx, groupId: null });
    expect(drafts).toEqual([]);
    expect(retractKeys).toEqual([activityKeys.badgeEarned('u1', 'c', 1), activityKeys.badgeEarned('u1', 'c', 2)]);
  });

  it('ogiltig previous_tier (NaN, 0, negativ) ger inga nycklar och ingen krasch', () => {
    const { retractKeys } = badgeNewsChanges(
      {
        ...empty(),
        downgrades: [downgrade('a', 1, Number.NaN)],
        deletes: [{ series: 'b', previous_tier: 0 }, { series: 'c', previous_tier: -2 }],
      },
      ctx,
    );
    expect(retractKeys).toEqual([]);
  });

  it('muterar aldrig indata', () => {
    const diff: BadgeDiff = { ...empty(), inserts: [insert('a', 1)], deletes: [{ series: 'c', previous_tier: 2 }] };
    const copy = structuredClone(diff);
    badgeNewsChanges(diff, ctx);
    expect(diff).toEqual(copy);
  });

  it('exporteras från paketets index', () => {
    expect(shared.badgeNewsChanges).toBe(badgeNewsChanges);
  });
});
