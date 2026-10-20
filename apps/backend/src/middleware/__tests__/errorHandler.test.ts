import { describe, it, expect, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { jsonErrorHandler, notFoundHandler } from '../errorHandler.js';

function fakeRes(headersSent = false) {
  const calls: { status?: number; body?: unknown; json: number } = { json: 0 };
  const res = {
    headersSent,
    status(code: number) { calls.status = code; return res; },
    json(body: unknown) { calls.body = body; calls.json++; return res; },
  } as unknown as Response;
  return { res, calls };
}
const req = { method: 'GET', path: '/api/x', originalUrl: '/api/x?code=SECRET' } as unknown as Request;

describe('jsonErrorHandler', () => {
  it('hands the error on and sends nothing when the headers are already sent (Express closes the connection)', () => {
    const { res, calls } = fakeRes(true);
    const next = vi.fn() as unknown as NextFunction;
    const error = new Error('half-way');
    jsonErrorHandler(error, req, res, next);
    expect(next).toHaveBeenCalledWith(error);
    expect(calls.json).toBe(0);
    expect(calls.status).toBeUndefined();
  });

  it('sends exactly one answer and does not call next for an error before the headers', () => {
    const { res, calls } = fakeRes(false);
    const next = vi.fn() as unknown as NextFunction;
    jsonErrorHandler(new Error('x'), req, res, next);
    expect(calls.json).toBe(1);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    [{ type: 'entity.parse.failed', status: 400 }, 400, 'invalid_json', 'Invalid JSON body'],
    [{ type: 'entity.too.large', status: 413 }, 413, 'payload_too_large', 'Request body too large'],
    [{ type: 'encoding.unsupported', status: 415 }, 415, 'unsupported_media_type', 'Unsupported media type'],
    [{ type: 'charset.unsupported', status: 415 }, 415, 'unsupported_media_type', 'Unsupported media type'],
    [{ status: 400 }, 400, 'invalid_request', 'Invalid request'],
    [{ status: 405 }, 405, 'invalid_request', 'Invalid request'],
    [{ statusCode: 422 }, 422, 'invalid_request', 'Invalid request'],
    [{}, 500, 'internal_error', 'Internal server error'],
    [{ status: 500 }, 500, 'internal_error', 'Internal server error'],
    [{ status: 503 }, 503, 'service_unavailable', 'Service unavailable'],
    [{ status: 504 }, 504, 'internal_error', 'Internal server error'],
    [{ status: 'abc' }, 500, 'internal_error', 'Internal server error'],
    [{ status: 399 }, 500, 'internal_error', 'Internal server error'],
    [{ status: 600 }, 500, 'internal_error', 'Internal server error'],
  ])('maps %j to %i %s', (extra, status, code, text) => {
    const { res, calls } = fakeRes();
    jsonErrorHandler(Object.assign(new Error('message that must not appear'), extra), req, res, vi.fn());
    expect(calls.status).toBe(status);
    expect(calls.body).toEqual({ success: false, error: text, code });
    expect(JSON.stringify(calls.body)).not.toContain('must not appear');
  });

  it('maps a thrown value that is not an Error to a fixed 500', () => {
    for (const thrown of ['a string with token SECRET', null, undefined, 42, { message: 'token SECRET', status: 400, type: 'x' }]) {
      const { res, calls } = fakeRes();
      jsonErrorHandler(thrown, req, res, vi.fn());
      expect(JSON.stringify(calls.body)).not.toContain('SECRET');
      expect(calls.body).toMatchObject({ success: false });
    }
  });
});

describe('notFoundHandler', () => {
  it('answers 404 route_not_found without path and method', () => {
    const { res, calls } = fakeRes();
    notFoundHandler(req, res);
    expect(calls.status).toBe(404);
    expect(calls.body).toEqual({ success: false, error: 'Route not found', code: 'route_not_found' });
  });
});
