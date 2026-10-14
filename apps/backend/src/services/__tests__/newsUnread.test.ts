/**
 * Oläst-tjänsten (ADR 011 beslut 4): hur rader och läsningar mappas till isNotifiable. Själva reglerna (golv, slag,
 * backfill, created_at) testas i shared; här testas bara kopplingen: typkonvertering av bigint-kolumner, fail-closed
 * vid trasiga värden och att betraktaren byggs av de tre läsningarna.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { isRowUnread, loadUnreadState, toNotifiableRow, UNREAD_CAP, type CandidateRow } from '../newsUnread.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

const USER_CREATED = '2026-01-01T00:00:00.000Z';
const AFTER_USER = '2026-06-01T00:00:00.000Z';

const reader = { news_last_seen_id: null, created_at: USER_CREATED };

function candidate(over: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: 10, type: 'level_up', actor_user_id: 'u2', target_user_id: null, payload: {},
    is_backfill: false, created_at: AFTER_USER, ...over,
  };
}

function activity(id: number, over: Row = {}): Row {
  return {
    id, group_id: 'g1', type: 'level_up', actor_user_id: 'u2', target_user_id: null, payload: {},
    is_backfill: false, created_at: AFTER_USER, ...over,
  };
}

function use(tables: Record<string, Row[]>, options: Parameters<typeof createFakeDb>[1] = {}) {
  const db = createFakeDb(tables, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
  return db;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('toNotifiableRow', () => {
  it('konverterar ett id som kommer som sträng (bigint) till tal och byter till camelCase', () => {
    expect(toNotifiableRow(candidate({ id: '42', actor_user_id: 'u2', target_user_id: 'u1' }))).toEqual({
      id: 42, type: 'level_up', actorId: 'u2', targetId: 'u1', payload: {}, isBackfill: false, createdAt: AFTER_USER,
    });
  });

  it('ger en rad vars id inte är ett tal som aldrig är oläst (fail-closed)', () => {
    const viewer = { id: 'u1', createdAt: USER_CREATED, floor: null, readIds: new Set<number>(), settings: {} };
    expect(isRowUnread(candidate({ id: 'inte-ett-tal' }), viewer)).toBe(false);
    expect(isRowUnread(candidate({ id: '10' }), viewer)).toBe(true);
  });

  it('räknar en rad med saknad backfill-flagga som backfill (fail-closed)', () => {
    const viewer = { id: 'u1', createdAt: USER_CREATED, floor: null, readIds: new Set<number>(), settings: {} };
    expect(isRowUnread(candidate({ is_backfill: null }), viewer)).toBe(false);
  });
});

describe('loadUnreadState', () => {
  it('bygger betraktaren av golv, news_read-id:n (även som strängar) och upplösta inställningar', async () => {
    use({
      activity_log: [activity(1), activity(2), activity(3)],
      news_read: [{ user_id: 'u1', activity_id: '3' }],
      user_settings: [{ user_id: 'u1', key: 'notify.level_up_others', value: false }],
    });
    const state = await loadUnreadState('g1', 'u1', { news_last_seen_id: 1, created_at: USER_CREATED });
    expect(state.viewer).toMatchObject({ id: 'u1', createdAt: USER_CREATED, floor: 1 });
    expect([...state.viewer.readIds]).toEqual([3]);
    expect(state.viewer.settings['notify.level_up_others']).toBe(false);
    expect(state.viewer.settings['notify.event_open']).toBe(true); // oberörd default
    expect(state.unreadCount).toBe(0);
  });

  it('ett null-golv skickas vidare som null (betyder 0)', async () => {
    use({ activity_log: [activity(1)] });
    const state = await loadUnreadState('g1', 'u1', reader);
    expect(state.viewer.floor).toBeNull();
    expect(state.unreadCount).toBe(1);
  });

  it('ignorerar en lagrad inställning med fel typ (default gäller) utan att kasta', async () => {
    use({
      activity_log: [activity(1)],
      user_settings: [{ user_id: 'u1', key: 'notify.level_up_others', value: 'nej' }],
    });
    const state = await loadUnreadState('g1', 'u1', reader);
    expect(state.unreadCount).toBe(1);
  });

  it('taket är 500', () => {
    expect(UNREAD_CAP).toBe(500);
  });
});
