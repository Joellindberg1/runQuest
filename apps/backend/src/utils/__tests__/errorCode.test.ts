import { describe, it, expect } from 'vitest';
import { errorCode, errorWithCode } from '../errorCode.js';

/** The error supabase-js (postgrest-js 2.x) returns instead of throwing when fetch fails: no code, no name, the cause only in the text. */
function supabaseNetworkError(fetchMessage: string, causeLine: string, extra: Record<string, string> = {}) {
  return {
    message: `TypeError: ${fetchMessage}`,
    details: `TypeError: ${fetchMessage}\n\nCaused by: ${causeLine}\nError: read at TCP.onStreamRead (node:internal/stream_base_commons:216:20)`,
    hint: '',
    code: '',
    ...extra,
  };
}

describe('errorCode when the code is empty (supabase-js network failure)', () => {
  it.each([
    ['ECONNRESET', 'Error: read ECONNRESET (ECONNRESET)'],
    ['ECONNREFUSED', 'Error: connect ECONNREFUSED 10.0.0.4:5432 (ECONNREFUSED)'],
    ['ETIMEDOUT', 'Error: connect ETIMEDOUT 10.0.0.4:443 (ETIMEDOUT)'],
    ['ENOTFOUND', 'Error: getaddrinfo ENOTFOUND db.example.supabase.co (ENOTFOUND)'],
    ['UND_ERR_SOCKET', 'SocketError: other side closed (UND_ERR_SOCKET)'],
    ['UND_ERR_CONNECT_TIMEOUT', 'ConnectTimeoutError: Connect Timeout Error (UND_ERR_CONNECT_TIMEOUT)'],
  ])('reads %s out of the cause text', (expected, causeLine) => {
    expect(errorCode(supabaseNetworkError('fetch failed', causeLine))).toBe(expected);
  });

  it('reads the code off a real fetch error with a cause', () => {
    const cause = Object.assign(new Error('read ECONNRESET jane@example.com'), { code: 'ECONNRESET' });
    expect(errorCode(new TypeError('fetch failed', { cause }))).toBe('ECONNRESET');
  });

  it('reads the code of a nested cause', () => {
    const inner = Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' });
    const outer = new Error('wrapper', { cause: new Error('agg', { cause: inner }) });
    expect(errorCode(outer)).toBe('ECONNREFUSED');
  });

  it('names a fetch failure without a recognisable cause', () => {
    expect(errorCode({ message: 'TypeError: fetch failed', details: '', hint: '', code: '' })).toBe('fetch_failed');
  });

  it('names an aborted request', () => {
    expect(errorCode({ message: 'AbortError: This operation was aborted', details: '', hint: 'Request was aborted (timeout or manual cancellation)', code: '' })).toBe('AbortError');
  });

  it('keeps a non-empty code over the cause', () => {
    expect(errorCode(supabaseNetworkError('fetch failed', 'Error: read ECONNRESET (ECONNRESET)', { code: '57014' }))).toBe('57014');
  });

  it('ignores a cause code that is not on the list, and never returns text from the message or the details', () => {
    const leaky = {
      message: 'duplicate key value violates unique constraint (email)=(jane@example.com)',
      details: 'Key (email)=(jane@example.com) already exists. Caused by: Error: x (ESECRET_jane@example.com)',
      hint: '',
      code: '',
    };
    expect(errorCode(leaky)).toBe('unknown');
    expect(errorCode(Object.assign(new Error('boom'), { cause: { code: 'ESECRET_jane@example.com' } }))).toBe('Error');
  });

  it('does not match a listed code that is only part of a longer word', () => {
    expect(errorCode({ message: 'row NOT_ECONNRESET_X', details: '', hint: '', code: '' })).toBe('unknown');
  });
});

describe('errorWithCode', () => {
  it('builds an Error with a fixed message and the code of the source, never the source text', () => {
    const source = { message: 'duplicate key (email)=(jane@example.com)', code: '23505' };
    const error = errorWithCode('Failed to save weather for run abc', source);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Failed to save weather for run abc');
    expect(error.code).toBe('23505');
    expect(errorCode(error)).toBe('23505');
  });

  it('gets the cause-derived code for a network failure', () => {
    const error = errorWithCode('Failed to read x', supabaseNetworkError('fetch failed', 'Error: read ECONNRESET (ECONNRESET)'));
    expect(error.code).toBe('ECONNRESET');
  });
});

describe('errorCode', () => {
  it('uses the code of a database error', () => {
    expect(errorCode({ message: 'duplicate key (email)=(jane@example.com)', code: '23505' })).toBe('23505');
  });

  it('falls back to the name when there is no code', () => {
    expect(errorCode(new TypeError('boom with jane@example.com'))).toBe('TypeError');
  });

  it('falls back to the name when the code is an empty string', () => {
    expect(errorCode({ code: '', name: 'PostgrestError', message: 'row value leak' })).toBe('PostgrestError');
  });

  it('falls back to unknown when both the code and the name are empty', () => {
    expect(errorCode({ code: '', name: '' })).toBe('unknown');
  });

  it('returns unknown for values without a code or a name', () => {
    expect(errorCode(null)).toBe('unknown');
    expect(errorCode(undefined)).toBe('unknown');
    expect(errorCode('a string with jane@example.com')).toBe('unknown');
  });

  it('keeps only safe characters and at most 40 of them', () => {
    expect(errorCode({ code: 'a b@c.d' })).toBe('abc.d');
    expect(errorCode({ code: 'x'.repeat(100) })).toHaveLength(40);
  });
});
