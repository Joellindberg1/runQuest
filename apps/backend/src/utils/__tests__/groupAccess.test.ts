/**
 * Gruppbehörighet för skrivningar (ADR 012 beslut 6.4): gruppen kommer ur det aktiva medlemskapet i databasen och ges bara om
 * rollen får skriva inställningar. Databasen är fejkad (group_members); den som testas är beslutet, inte frågan mot Postgres.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { createFakeDb, type FakeDbOptions, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { actingGroupForWriteOrRespond, resolveActingGroupForWrite } from '../groupAccess.js';
import { logger } from '../logger.js';

const NOW = '2026-10-01T10:00:00Z';

const membership = (over: Row): Row => ({ id: `m-${over.user_id}-${over.group_id}`, role: 'member', left_at: null, joined_at: NOW, starts_on: null, ...over });

function setup(group_members: Row[], options: FakeDbOptions = {}) {
  const db = createFakeDb({ group_members }, options);
  return { db: db.client as any, queries: db.queries };
}

describe('resolveActingGroupForWrite', () => {
  it('gives the group of an admin with an active membership', async () => {
    const { db } = setup([membership({ user_id: 'admin-1', group_id: 'g1', role: 'admin' })]);
    expect(await resolveActingGroupForWrite('admin-1', db)).toEqual({ allowed: true, groupId: 'g1' });
  });

  it('denies a member who is not an admin', async () => {
    const { db } = setup([membership({ user_id: 'u1', group_id: 'g1', role: 'member' })]);
    expect(await resolveActingGroupForWrite('u1', db)).toEqual({ allowed: false, reason: 'forbidden' });
  });

  it('denies a user without any membership', async () => {
    const { db } = setup([membership({ user_id: 'someone-else', group_id: 'g1', role: 'admin' })]);
    expect(await resolveActingGroupForWrite('u1', db)).toEqual({ allowed: false, reason: 'forbidden' });
  });

  it('denies a user whose admin membership has been left', async () => {
    const { db } = setup([membership({ user_id: 'admin-1', group_id: 'g1', role: 'admin', left_at: '2026-09-01T00:00:00Z' })]);
    expect(await resolveActingGroupForWrite('admin-1', db)).toEqual({ allowed: false, reason: 'forbidden' });
  });

  it('denies an admin of another group and never hands out that other group', async () => {
    const { db } = setup([
      membership({ user_id: 'admin-b', group_id: 'g-b', role: 'admin' }),
      membership({ user_id: 'u1', group_id: 'g-a', role: 'member' }),
    ]);
    expect(await resolveActingGroupForWrite('u1', db)).toEqual({ allowed: false, reason: 'forbidden' });
  });

  it('acts in the group the database says, not in another group the user is admin of elsewhere', async () => {
    const { db } = setup([
      membership({ user_id: 'u1', group_id: 'g-old', role: 'admin', left_at: '2026-09-01T00:00:00Z' }),
      membership({ user_id: 'u1', group_id: 'g-now', role: 'admin' }),
    ]);
    expect(await resolveActingGroupForWrite('u1', db)).toEqual({ allowed: true, groupId: 'g-now' });
  });

  it('treats a database error as denied, reported as unavailable', async () => {
    const { db } = setup([membership({ user_id: 'admin-1', group_id: 'g1', role: 'admin' })], {
      failWhen: () => ({ message: 'connection to row for admin-1 lost', code: '57P01' }),
    });
    expect(await resolveActingGroupForWrite('admin-1', db)).toEqual({ allowed: false, reason: 'unavailable' });
  });

  it('treats a dropped connection (empty code) as denied, reported as unavailable', async () => {
    const { db } = setup([membership({ user_id: 'admin-1', group_id: 'g1', role: 'admin' })], {
      failWhen: () => ({ message: 'TypeError: fetch failed', code: '' }),
    });
    expect(await resolveActingGroupForWrite('admin-1', db)).toEqual({ allowed: false, reason: 'unavailable' });
  });

  it('treats two active memberships (the database should hold one) as denied, reported as unavailable', async () => {
    const { db } = setup([
      membership({ user_id: 'admin-1', group_id: 'g1', role: 'admin' }),
      membership({ user_id: 'admin-1', group_id: 'g2', role: 'admin' }),
    ]);
    expect(await resolveActingGroupForWrite('admin-1', db)).toEqual({ allowed: false, reason: 'unavailable' });
  });

  it.each([
    ['an empty string', ''],
    ['null', null],
    ['a number', 7],
  ])('denies an admin membership whose group id is %s, instead of handing out a group that is not one', async (_name, groupId) => {
    const { db } = setup([membership({ user_id: 'admin-1', group_id: groupId, role: 'admin' })]);
    expect(await resolveActingGroupForWrite('admin-1', db)).toEqual({ allowed: false, reason: 'unavailable' });
  });

  it('answers 500 through the route form, exactly once, for a membership without a usable group id', async () => {
    const { db } = setup([membership({ user_id: 'admin-1', group_id: '', role: 'admin' })]);
    const res = resMock();
    expect(await actingGroupForWriteOrRespond(reqFor({ user_id: 'admin-1' }), res, db)).toBeNull();
    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledTimes(1);
  });

  it('logs the database code on a failed read, and neither the user id nor the database text', async () => {
    const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => {});
    try {
      const { db } = setup([], { failWhen: () => ({ message: 'row for admin-1 holds secret 4711', code: '57P01', details: 'Key (user_id)=(admin-1)' }) });
      await resolveActingGroupForWrite('admin-1', db);
      expect(errorLog).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(errorLog.mock.calls);
      expect(logged).toContain('57P01');
      expect(logged).not.toMatch(/admin-1|4711|secret/);
    } finally {
      errorLog.mockRestore();
    }
  });

  it('logs only a label, never the text, when the client itself throws', async () => {
    const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => {});
    try {
      const throwing = { from: () => { throw Object.assign(new Error('client for admin-1 holds secret 4711'), { code: 'CLIENT_DOWN' }); } } as any;
      await resolveActingGroupForWrite('admin-1', throwing);
      expect(errorLog).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(errorLog.mock.calls);
      expect(logged).toContain('CLIENT_DOWN');
      expect(logged).not.toMatch(/admin-1|4711|secret/);
    } finally {
      errorLog.mockRestore();
    }
  });

  it('treats a role the database should never hold as denied, not as a guess', async () => {
    const { db } = setup([membership({ user_id: 'u1', group_id: 'g1', role: 'emperor' })]);
    expect(await resolveActingGroupForWrite('u1', db)).toEqual({ allowed: false, reason: 'unavailable' });
  });

  it('denies when the lookup throws instead of returning an error', async () => {
    const throwing = { from: () => { throw new Error('client not configured'); } } as any;
    expect(await resolveActingGroupForWrite('admin-1', throwing)).toEqual({ allowed: false, reason: 'unavailable' });
  });

  it('reads the membership for the user from the database and writes nothing', async () => {
    const { db, queries } = setup([membership({ user_id: 'admin-1', group_id: 'g1', role: 'admin' })]);
    await resolveActingGroupForWrite('admin-1', db);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({ table: 'group_members', filters: expect.arrayContaining([{ op: 'eq', column: 'user_id', value: 'admin-1' }, { op: 'is', column: 'left_at', value: null }]) });
    expect(queries[0]!.mutation).toBeUndefined();
  });

  it('keeps the database error text and the user id out of its answer', async () => {
    const { db } = setup([], { failWhen: () => ({ message: 'secret row value 4711', code: '42P01', details: 'Key (user_id)=(admin-1)' }) });
    const answer = await resolveActingGroupForWrite('admin-1', db);
    expect(JSON.stringify(answer)).not.toMatch(/4711|admin-1/);
  });
});

function reqFor(user: { user_id: string; group_id?: string } | undefined): Request {
  return { user: user && { name: 'n', email: 'e', ...user }, params: {}, query: {}, body: {}, headers: {} } as unknown as Request;
}

function resMock() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe('actingGroupForWriteOrRespond', () => {
  it('returns the group and sends nothing for an admin', async () => {
    const { db } = setup([membership({ user_id: 'admin-1', group_id: 'g1', role: 'admin' })]);
    const res = resMock();
    expect(await actingGroupForWriteOrRespond(reqFor({ user_id: 'admin-1', group_id: 'g1' }), res, db)).toBe('g1');
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('ignores a stale group in the token and returns the group from the database', async () => {
    const { db } = setup([membership({ user_id: 'admin-1', group_id: 'g-now', role: 'admin' })]);
    const res = resMock();
    expect(await actingGroupForWriteOrRespond(reqFor({ user_id: 'admin-1', group_id: 'g-stale' }), res, db)).toBe('g-now');
  });

  it('denies a token that claims a group the user is not in, even when the claim is the group of another admin', async () => {
    const { db } = setup([
      membership({ user_id: 'admin-b', group_id: 'g-b', role: 'admin' }),
      membership({ user_id: 'u1', group_id: 'g-a', role: 'member' }),
    ]);
    const res = resMock();
    expect(await actingGroupForWriteOrRespond(reqFor({ user_id: 'u1', group_id: 'g-b' }), res, db)).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('answers the same 403 body for a non-member, a member who is not admin, and an admin of another group', async () => {
    const bodies: unknown[] = [];
    const cases: Array<[string, Row[]]> = [
      ['no membership', []],
      ['a plain member', [membership({ user_id: 'u1', group_id: 'g1', role: 'member' })]],
      ['an admin elsewhere', [membership({ user_id: 'admin-b', group_id: 'g-b', role: 'admin' })]],
    ];
    for (const [, rows] of cases) {
      const { db } = setup(rows);
      const res = resMock();
      expect(await actingGroupForWriteOrRespond(reqFor({ user_id: 'u1', group_id: 'g-b' }), res, db)).toBeNull();
      expect(res.status).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledTimes(1);
      bodies.push(res.json.mock.calls[0]![0]);
    }
    const forbidden = { success: false, error: 'Forbidden', code: 'forbidden' };
    expect(bodies).toEqual([forbidden, forbidden, forbidden]);
  });

  it('answers 500 with a generic body on a database error', async () => {
    const { db } = setup([], { failWhen: () => ({ message: 'boom for g1', code: '57P01' }) });
    const res = resMock();
    expect(await actingGroupForWriteOrRespond(reqFor({ user_id: 'admin-1', group_id: 'g1' }), res, db)).toBeNull();
    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Internal server error', code: 'internal_error' });
  });

  it('answers 403 and never touches the database when there is no authenticated user', async () => {
    const { db, queries } = setup([membership({ user_id: 'admin-1', group_id: 'g1', role: 'admin' })]);
    const res = resMock();
    expect(await actingGroupForWriteOrRespond(reqFor(undefined), res, db)).toBeNull();
    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(queries).toHaveLength(0);
  });
});
