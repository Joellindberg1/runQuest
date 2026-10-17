// The revoke step of "Disconnect" (ADR 010 decision 7.4.2): asks Strava to withdraw RunQuest's authorisation, so Strava stops
// sending events for the user. It is the `revoke` option of removeStravaConnection (services/stravaConnection.ts), which calls it
// FIRST and only for reason 'user_disconnect', because the tokens leave with the strava_tokens row.
//
// Contract with the caller:
//   - It resolves when Strava accepted the revoke, and when there is nothing to revoke (no token row: a rerun after a completed
//     removal). It rejects with an error whose `code` says why it did not revoke; removeStravaConnection logs that as a warning and
//     carries on (the user chose to disconnect, the runs must go whatever Strava answers).
//   - It never takes a lock. The route already holds withUserLock(userId) around the whole removal and the lock is not reentrant
//     (utils/keyedMutex.ts): a second lock here would throw ReentrantLockError, the caller would log it as an ordinary revoke
//     failure and the revoke would be skipped without anyone noticing.
//   - It is bounded in time. The lock is held while it runs and has no timeout of its own, so a hanging Strava call must not be able
//     to hold it: one deadline covers the token lookup (which may renew the token) and the deauthorize call.
//   - It only reads the token row (through getValidAccessToken) and never after the removal has begun deleting: the caller runs it
//     before the first delete.
//
// Error codes (never a message, a body or a token): strava_<status> for a non-2xx answer, strava_timeout, strava_network,
// strava_refresh_failed, strava_refresh_rejected, strava_no_refresh_token, strava_token_read_failed.
import { getValidAccessToken, stravaFetch, type AccessTokenFailureReason } from './stravaClient.js';

const STRAVA_DEAUTHORIZE_URL = 'https://www.strava.com/oauth/deauthorize';

/** Long enough for a slow Strava, short enough that the user's lock (and the Settings request) is never held for long. */
export const REVOKE_TIMEOUT_MS = 10_000;

export interface RevokeOptions {
  /** Injectable for tests. */
  timeoutMs?: number;
}

function revokeError(code: string): Error {
  return Object.assign(new Error(`strava revoke failed (${code})`), { code });
}

/** Why no token was had, as one of our codes. `not_connected` is handled by the caller (there is nothing to revoke), so it has no code. */
function revokeCodeForTokenFailure(reason: Exclude<AccessTokenFailureReason, 'not_connected'>): string {
  switch (reason) {
    case 'refresh_failed': return 'strava_refresh_failed';
    // Strava already refused the refresh token, so the authorisation is gone or invalid: nothing to revoke. Still a warning, the
    // disconnect carries on.
    case 'refresh_rejected': return 'strava_refresh_rejected';
    case 'no_refresh_token': return 'strava_no_refresh_token';
    // The row could not be read, so the revoke could not even be tried. It must not look like "nothing to revoke".
    case 'token_read_failed': return 'strava_token_read_failed';
  }
}

/** Settles with `work`, or rejects with strava_timeout when the deadline passes first. `work` is left to finish on its own. */
function beforeDeadline<T>(work: Promise<T>, deadline: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (deadline.aborted) {
      work.catch(() => {});
      reject(revokeError('strava_timeout'));
      return;
    }
    const onAbort = () => reject(revokeError('strava_timeout'));
    deadline.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => deadline.removeEventListener('abort', onAbort));
  });
}

/** A failure that already carries one of our codes stays as it is; anything else is the network (or the deadline). */
function asRevokeError(error: unknown, deadline: AbortSignal): Error {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code.startsWith('strava_')) return error as Error;
  // TimeoutError: stravaFetch's own limit (also the name AbortSignal.timeout gives), as opposed to our deadline above.
  const timedOut = deadline.aborted || (error as { name?: unknown } | null)?.name === 'TimeoutError';
  return revokeError(timedOut ? 'strava_timeout' : 'strava_network');
}

/**
 * POST /oauth/deauthorize with the user's access token (renewed first when it has expired). See the header for the contract.
 * The token goes in the form body as Strava documents and in the Authorization header as Strava's own examples show it; it is
 * never logged.
 */
export async function revokeStravaAuthorization(userId: string, options: RevokeOptions = {}): Promise<void> {
  if (typeof userId !== 'string' || userId === '') throw new TypeError('revokeStravaAuthorization needs a user id');
  const deadline = AbortSignal.timeout(options.timeoutMs ?? REVOKE_TIMEOUT_MS);

  try {
    const token = await beforeDeadline(getValidAccessToken(userId), deadline);
    if (!token.ok) {
      if (token.reason === 'not_connected') return; // nothing to revoke: a rerun after a completed removal
      throw revokeError(revokeCodeForTokenFailure(token.reason));
    }

    const response = await beforeDeadline(
      stravaFetch(STRAVA_DEAUTHORIZE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Bearer ${token.accessToken}`,
        },
        body: new URLSearchParams({ access_token: token.accessToken }).toString(),
        signal: deadline,
      }),
      deadline,
    );
    // Only the status matters; the body is not read, so it cannot hold the lock or end up in a log.
    void response.body?.cancel().catch(() => {});
    if (!response.ok) throw revokeError(`strava_${response.status}`);
  } catch (error) {
    throw asRevokeError(error, deadline);
  }
}
