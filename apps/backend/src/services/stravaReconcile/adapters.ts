// The real ports of the nightly reconcile: Supabase for the users and the runs, the central Strava client for the activity list.
// Thin on purpose: every rule is in plan.ts and in services/stravaReconcile.ts.
//
// Errors from the database are rethrown with the PostgREST code only (the message can carry values from the row).
import { getSupabaseClient } from '../../config/database.js';
import { fetchAthleteActivities } from '../stravaClient.js';
import type { ListedActivity, StoredRun } from './plan.js';
import type { ListPageResult, ReconcilePorts, ReconcileUser } from './ports.js';

const PAGE_SIZE = 1000; // PostgREST's default cap on rows per request
const MAX_PAGES = 100;

function databaseError(operation: string, error: { code?: string }): Error {
  const code = error.code ?? 'unknown';
  return Object.assign(new Error(`${operation} failed (${code})`), { code });
}

/** A request for an offset beyond the last row (416): the end when the last page happened to be exactly full. */
const isOutOfRange = (error: { code?: string; status?: number }): boolean => error.code === 'PGRST103' || error.status === 416;

/** All rows of a query, a page at a time (a stable order is the caller's: without one, pages could skip or repeat rows). */
async function readAll<T>(
  operation: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; status?: number } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const from = index * PAGE_SIZE;
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) {
      if (from > 0 && isOutOfRange(error)) return rows;
      throw databaseError(operation, error);
    }
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) return rows;
  }
  throw databaseError(operation, { code: 'page_limit' });
}

export function createReconcilePorts(): ReconcilePorts {
  return {
    async listConnectedUsers() {
      const rows = await readAll<{ user_id: string; sync_paused: boolean | null }>('listConnectedUsers', (from, to) =>
        getSupabaseClient()
          .from('strava_tokens')
          .select('user_id, sync_paused')
          .not('access_token', 'is', null)
          .order('user_id', { ascending: true })
          .range(from, to),
      );
      // A pause that cannot be read as "not paused" counts as paused: the user is left alone.
      return rows.map((row): ReconcileUser => ({ userId: row.user_id, syncPaused: row.sync_paused !== false }));
    },

    async listStravaRuns(userId) {
      const rows = await readAll<{ external_id: string; date: string; distance: number | string }>('listStravaRuns', (from, to) =>
        getSupabaseClient()
          .from('runs')
          .select('external_id, date, distance')
          .eq('user_id', userId)
          .eq('source', 'strava') // a manual run is never looked at, whatever its id
          .not('external_id', 'is', null)
          .order('date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      );
      return rows.map((row): StoredRun => ({ externalId: String(row.external_id), date: row.date, distance: Number(row.distance) }));
    },

    async listActivities(accessToken, afterSeconds, page): Promise<ListPageResult> {
      try {
        const response = await fetchAthleteActivities(accessToken, afterSeconds, page);
        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          return { kind: 'failed', status: response.status };
        }
        const body: unknown = await response.json();
        if (!Array.isArray(body)) return { kind: 'failed', status: response.status };
        return { kind: 'ok', activities: body.filter((item): item is ListedActivity => typeof item === 'object' && item !== null) };
      } catch {
        return { kind: 'failed', status: null };
      }
    },
  };
}
