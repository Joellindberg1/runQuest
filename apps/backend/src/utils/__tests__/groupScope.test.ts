import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { groupIdOrRespondEmpty, groupIdOrRespondForbidden, tokenGroupId } from '../groupScope.js';

const reqWith = (group_id?: string): Request =>
  ({ user: { user_id: 'u1', name: 'n', email: 'e', group_id } }) as unknown as Request;
const resMock = () => ({ json: vi.fn() }) as unknown as Response & { json: ReturnType<typeof vi.fn> };

describe('groupIdOrRespondEmpty', () => {
  it('returns the group id and sends nothing when the token has a group', () => {
    const res = resMock();
    expect(groupIdOrRespondEmpty(reqWith('g1'), res)).toBe('g1');
    expect(res.json).not.toHaveBeenCalled();
  });

  it('answers the empty list and returns null when the token has no group', () => {
    const res = resMock();
    expect(groupIdOrRespondEmpty(reqWith(undefined), res)).toBeNull();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
  });

  it('treats an empty-string group as missing', () => {
    const res = resMock();
    expect(groupIdOrRespondEmpty(reqWith(''), res)).toBeNull();
    expect(res.json).toHaveBeenCalledTimes(1);
  });

  it('treats a missing user as no group (never throws)', () => {
    const res = resMock();
    expect(groupIdOrRespondEmpty({} as Request, res)).toBeNull();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
  });

  it('sends a custom empty body when given one', () => {
    const res = resMock();
    expect(groupIdOrRespondEmpty(reqWith(undefined), res, { runs: [] })).toBeNull();
    expect(res.json).toHaveBeenCalledWith({ runs: [] });
  });
});

describe('groupIdOrRespondForbidden', () => {
  const failMock = () => {
    const res = { status: vi.fn(), json: vi.fn() } as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
    res.status.mockReturnValue(res);
    return res;
  };

  it('returns the group id and sends nothing when the token has a group', () => {
    const res = failMock();
    expect(groupIdOrRespondForbidden(reqWith('g1'), res)).toBe('g1');
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each([['no group', undefined], ['an empty group', '']])('answers 403 group_required and returns null for a token with %s', (_name, group) => {
    const res = failMock();
    expect(groupIdOrRespondForbidden(reqWith(group), res)).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Admin must belong to a group', code: 'group_required' });
  });
});

describe('tokenGroupId', () => {
  it('returns the group of the token', () => {
    expect(tokenGroupId(reqWith('g1'))).toBe('g1');
  });

  it.each([['no group', reqWith(undefined)], ['an empty group', reqWith('')], ['no user', {} as Request]])('returns undefined for %s, and never answers', (_name, req) => {
    expect(tokenGroupId(req)).toBeUndefined();
  });
});
