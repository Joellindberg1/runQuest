// The database and Strava-list ports of the nightly reconcile (ADR 010 decision 17: orchestration over ports). The handler's own ports
// (StravaApi, RunStore, Recompute in stravaWebhook/ports.ts) are used as they are; these are only what reconcile alone needs.
import type { ListedActivity, StoredRun } from './plan.js';

export interface ReconcileUser {
  userId: string;
  /** strava_tokens.sync_paused */
  syncPaused: boolean;
}

/** One page of the athlete's activity list: the activities, or "no list" (any status that is not 200, an answer that is not a list, a network error). */
export type ListPageResult = { kind: 'ok'; activities: ListedActivity[] } | { kind: 'failed'; status: number | null };

export interface ReconcilePorts {
  /** Every user with a Strava connection, paused or not. THROWS on a database error (no list of users is no night). */
  listConnectedUsers(): Promise<ReconcileUser[]>;
  /** The user's Strava runs that have an external id: all of them, oldest first. THROWS on a database error. */
  listStravaRuns(userId: string): Promise<StoredRun[]>;
  /** One page (1-based) of the athlete's activities started after `afterSeconds` (epoch seconds), 200 to a page. Never throws. */
  listActivities(accessToken: string, afterSeconds: number, page: number): Promise<ListPageResult>;
}
