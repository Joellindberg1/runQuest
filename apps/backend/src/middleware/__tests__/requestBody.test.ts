import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { defaultEmptyBody } from '../requestBody.js';

const run = (body: unknown) => {
  const req = { body } as Request;
  const next = vi.fn();
  defaultEmptyBody(req, {} as Response, next);
  return { req, next };
};

describe('defaultEmptyBody', () => {
  it('gives a request without a parsed body an empty object and passes it on', () => {
    const { req, next } = run(undefined);
    expect(req.body).toEqual({});
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('leaves a body that a parser already read untouched', () => {
    const parsed = { distance: 5 };
    const list = [1, 2];
    const image = Buffer.from('abc');
    expect(run(parsed).req.body).toBe(parsed);
    expect(run(list).req.body).toBe(list);
    expect(run(image).req.body).toBe(image);
  });
});
