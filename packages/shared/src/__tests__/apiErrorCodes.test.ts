import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES, isApiErrorCode, type ApiErrorCode } from '../index.js';

// Katalogen är additiv och fäst: en ny kod är en granskad diff HÄR, i samma ändring som dess första användning (ADR 007 Addendum 2026-10-20 punkt 3).
// Koderna beskriver utfallet för anroparen. En uppströmskod (databas, nätverk, Strava, interna etiketter) hör hemma i loggen och får aldrig bli en API-kod.

const PINNED: readonly ApiErrorCode[] = [
  'invalid_request', 'invalid_json', 'consent_required', 'strava_not_connected', 'strava_authorization_failed', 'strava_sync_failed',
  'unauthorized', 'token_invalid', 'invalid_credentials', 'current_password_incorrect',
  'forbidden', 'admin_required', 'group_required',
  'not_found', 'route_not_found', 'invalid_invite_code',
  'conflict', 'sync_paused', 'strava_read_only', 'run_qualified_event', 'already_in_group', 'strava_account_in_use', 'user_exists',
  'payload_too_large', 'unsupported_media_type', 'rate_limited',
  'internal_error', 'recalc_failed_after_write', 'service_unavailable', 'strava_unavailable',
  'partial_failure',
];

describe('the API error code catalogue', () => {
  it('is exactly the pinned list', () => {
    expect([...API_ERROR_CODES].sort()).toEqual([...PINNED].sort());
  });

  it('has no duplicates', () => {
    expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length);
  });

  it('follows the format: snake_case, starts with a letter, at most 40 characters', () => {
    for (const code of API_ERROR_CODES) {
      expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(code.length).toBeLessThanOrEqual(40);
    }
  });

  it('contains no code that looks like an upstream code (Strava status, PostgREST, errno, internal seam labels)', () => {
    const upstream = [/^strava_\d{3}$/i, /^PGRST/i, /^E[A-Z]+$/, /^e[a-z]+$/, /^seam_/i, /^\d+$/];
    for (const code of API_ERROR_CODES) {
      for (const pattern of upstream) expect(code, `${code} looks like an upstream code (${pattern})`).not.toMatch(pattern);
    }
  });

  it('is recognised by isApiErrorCode, and an unknown code (from a newer server) is not', () => {
    expect(isApiErrorCode('consent_required')).toBe(true);
    expect(isApiErrorCode('some_future_code')).toBe(false);
    expect(isApiErrorCode(undefined)).toBe(false);
    expect(isApiErrorCode(401)).toBe(false);
  });
});
