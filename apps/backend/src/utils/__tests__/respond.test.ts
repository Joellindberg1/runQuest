import { describe, expect, it } from 'vitest';
import type { Response } from 'express';
import { API_ERROR_CODES, type ApiErrorCode, type DualEnvelope } from '@runquest/shared';
import { defaultErrorCode, fail, failWithData, failWithLegacy, failWritten, fixedErrorText, ok, okWithLegacy, type ErrorStatus } from '../respond.js';

/** Ett res som bara minns status och kropp. `status()` sätter, `json()` skickar, som Express. */
function fakeRes(initialStatus = 200) {
  const sent: { status: number; body: unknown; sends: number } = { status: initialStatus, body: undefined, sends: 0 };
  const res = {
    status(code: number) { sent.status = code; return res; },
    json(body: unknown) { sent.body = body; sent.sends++; return res; },
  } as unknown as Response;
  return { res, sent };
}

describe('ok', () => {
  it('sends { success: true, data } and keeps the status the response already has', () => {
    const { res, sent } = fakeRes();
    ok(res, { runs: [1, 2] });
    expect(sent.status).toBe(200);
    expect(sent.body).toEqual({ success: true, data: { runs: [1, 2] } });
  });

  it('carries meta at the top level and only when it is given', () => {
    const withMeta = fakeRes();
    ok(withMeta.res, [], { total: 0 });
    expect(withMeta.sent.body).toEqual({ success: true, data: [], meta: { total: 0 } });

    const withoutMeta = fakeRes();
    ok(withoutMeta.res, []);
    expect(Object.keys(withoutMeta.sent.body as object)).toEqual(['success', 'data']);
  });

  it('sends data: null when the action has no payload, never leaves data out', () => {
    for (const nothing of [null, undefined]) {
      const { res, sent } = fakeRes();
      ok(res, nothing);
      expect(sent.body).toEqual({ success: true, data: null });
      expect(sent.body).toHaveProperty('data', null);
    }
  });

  it('keeps a 201 that the caller set before the call', () => {
    const { res, sent } = fakeRes(201);
    ok(res, { challenge_id: 'c1' });
    expect(sent.status).toBe(201);
  });
});

describe('okWithLegacy', () => {
  it('sends data next to the old top-level keys (the double answer of step 1)', () => {
    const { res, sent } = fakeRes();
    okWithLegacy<DualEnvelope<{ events: string[] }>>(res, { events: ['e1'] }, { events: ['e1'] });
    expect(sent.body).toEqual({ success: true, events: ['e1'], data: { events: ['e1'] } });
  });

  it('keeps meta at the top level, next to the old keys and data', () => {
    const { res, sent } = fakeRes();
    okWithLegacy<DualEnvelope<{ runs: string[] }, { runs: string[] }, { total: number; has_more: boolean }>>(res, { runs: [] }, { runs: [] }, { total: 0, has_more: false });
    expect(sent.body).toEqual({ success: true, runs: [], data: { runs: [] }, meta: { total: 0, has_more: false } });
  });

  it('carries the old message and the new data in the same answer', () => {
    const { res, sent } = fakeRes();
    okWithLegacy<DualEnvelope<{ message: string; run: { id: string } }, { run: { id: string } }>>(res, { run: { id: 'r1' } }, { message: 'Run created successfully', run: { id: 'r1' } });
    expect(sent.body).toEqual({ success: true, message: 'Run created successfully', run: { id: 'r1' }, data: { run: { id: 'r1' } } });
  });

  it('sends data: null when there is no payload outside the old keys', () => {
    const { res, sent } = fakeRes();
    okWithLegacy<DualEnvelope<{ ok: true }, null>>(res, null, { ok: true });
    expect(sent.body).toEqual({ success: true, ok: true, data: null });
  });
});

describe('fail', () => {
  it('sends { success: false, error, code } with the status', () => {
    const { res, sent } = fakeRes();
    fail(res, 409, 'Sync is paused', 'sync_paused');
    expect(sent.status).toBe(409);
    expect(sent.body).toEqual({ success: false, error: 'Sync is paused', code: 'sync_paused' });
  });

  it('uses the default code of the status when no code is given', () => {
    const expected: Record<ErrorStatus, ApiErrorCode> = {
      400: 'invalid_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'conflict',
      413: 'payload_too_large', 415: 'unsupported_media_type', 429: 'rate_limited', 500: 'internal_error', 503: 'service_unavailable',
    };
    for (const [status, code] of Object.entries(expected)) {
      const { res, sent } = fakeRes();
      fail(res, Number(status) as ErrorStatus, 'text');
      expect(sent.body).toEqual({ success: false, error: 'text', code });
      expect(defaultErrorCode(Number(status) as ErrorStatus)).toBe(code);
    }
  });

  it('only uses codes that are in the catalogue, for every status', () => {
    for (const status of [400, 401, 403, 404, 409, 413, 415, 429, 500, 503] as const) {
      expect(API_ERROR_CODES).toContain(defaultErrorCode(status));
    }
  });

  it('sends nothing but success, error and code', () => {
    const { res, sent } = fakeRes();
    fail(res, 404, 'User not found');
    expect(Object.keys(sent.body as object).sort()).toEqual(['code', 'error', 'success']);
  });

  it('never echoes an Error that slips in through a cast: the fixed text of the status takes its place', () => {
    const leaky = new Error('duplicate key value violates unique constraint "runs_pkey" for activity 12345678901');
    const { res, sent } = fakeRes();
    fail(res, 500, leaky as unknown as string);
    expect(sent.status).toBe(500);
    expect(sent.body).toEqual({ success: false, error: fixedErrorText(500), code: 'internal_error' });
    expect(JSON.stringify(sent.body)).not.toContain('12345678901');
    expect(JSON.stringify(sent.body)).not.toContain('runs_pkey');
  });

  it('never echoes an object either', () => {
    const { res, sent } = fakeRes();
    fail(res, 400, { message: 'token SECRET', stack: 'at x' } as unknown as string);
    expect(JSON.stringify(sent.body)).not.toContain('SECRET');
    expect(sent.body).toMatchObject({ error: fixedErrorText(400) });
  });

  it('does not log or report anything itself', () => {
    // fail/ok har inget logger-beroende: loggningen ligger hos anroparen, så en händelse aldrig skickas två gånger.
    const { res } = fakeRes();
    expect(() => fail(res, 500, 'Failed to fetch runs')).not.toThrow();
  });
});

describe('failWithData', () => {
  it('sends the counters in data and the code, with the given status (207 is the only 2xx answer with success: false)', () => {
    const { res, sent } = fakeRes();
    failWithData(res, 207, '1 of 3 users failed; the rest were recalculated', 'partial_failure', { total: 3, processed: 2, failed: 1 });
    expect(sent.status).toBe(207);
    expect(sent.body).toEqual({
      success: false, error: '1 of 3 users failed; the rest were recalculated', code: 'partial_failure', data: { total: 3, processed: 2, failed: 1 },
    });
  });
});

describe('failWithLegacy', () => {
  it('keeps the old top-level fields next to data during the double-answer window (207 and 500 of reprocess-all)', () => {
    const { res, sent } = fakeRes();
    const counts = { total: 3, processed: 2, failed: 1 };
    failWithLegacy(res, 207, '1 of 3 users failed; the rest were recalculated', 'partial_failure', counts, { message: '1 of 3 users failed; the rest were recalculated', ...counts });
    expect(sent.status).toBe(207);
    expect(sent.body).toEqual({
      success: false,
      error: '1 of 3 users failed; the rest were recalculated',
      code: 'partial_failure',
      data: counts,
      message: '1 of 3 users failed; the rest were recalculated',
      total: 3,
      processed: 2,
      failed: 1,
    });
  });
});

describe('failWritten', () => {
  it('sends 500 with the code recalc_failed_after_write and written: true during the double-answer window', () => {
    const { res, sent } = fakeRes();
    failWritten(res, 'Run was created but XP recalculation failed');
    expect(sent.status).toBe(500);
    expect(sent.body).toEqual({ success: false, error: 'Run was created but XP recalculation failed', code: 'recalc_failed_after_write', written: true });
  });
});
