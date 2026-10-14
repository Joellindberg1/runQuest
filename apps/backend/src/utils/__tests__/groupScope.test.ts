import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { groupIdOrRespondEmpty } from '../groupScope.js';

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
