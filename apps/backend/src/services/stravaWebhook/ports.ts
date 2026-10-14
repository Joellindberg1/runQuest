// The ports of the Strava webhook worker (ADR 010 decision 17). The worker (services/stravaWebhookWorker.ts) is orchestration
// over these four interfaces, so it can be behaviour-tested against the in-memory versions in test-utils/ without a fake
// Supabase client. The real versions are in supabaseAdapters.ts.
import type { AccessTokenResult } from '../stravaClient.js';
import type { WebhookAspectType, WebhookObjectType, WebhookOutcome, WebhookStatus } from './constants.js';
import type { ExistingRun, StravaResponse } from './decideAction.js';

/** One row of strava_webhook_events, as claim_strava_webhook_events returns it (migration 046). Timestamps are ISO strings. */
export interface WebhookEventRow {
  id: number;
  dedupe_key: string;
  object_type: WebhookObjectType;
  object_id: number;
  aspect_type: WebhookAspectType;
  /** Strava's athlete id. */
  owner_id: number;
  subscription_id: number;
  event_time: string;
  /** Only the whitelisted keys private, type and authorized; never a title. */
  updates: Record<string, unknown>;
  /** From the mapping at receipt; null when the user has been deleted since (on delete set null). */
  user_id: string | null;
  status: WebhookStatus;
  outcome: string | null;
  /** Failed attempts so far, an expired lease counted as one. */
  attempts: number;
  next_attempt_at: string;
  claimed_at: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
  received_at: string;
  processed_at: string | null;
}

/** A claimed row goes back to the queue: pending, a new next_attempt_at and, for a failure, one more attempt. */
export interface ReleaseWrite {
  /** The value to store: the row's attempts + 1 for a failure, unchanged for a rate-limit wait. */
  attempts: number;
  nextAttemptAt: Date;
  lastError: string;
}

export interface WebhookEventStore {
  /** The RPC: expired leases back to pending, then up to `max` due rows of one owner, oldest first, as processing. */
  claim(leaseSeconds: number, max: number): Promise<WebhookEventRow[]>;
  /**
   * The writes below take the row as claimed and apply only if it is still the same claim: status `processing` AND the same
   * `claimed_at` (the lease token). They say whether a row was written. A row whose lease ran out and was claimed again has a new
   * `claimed_at`, so a late write from the old claim is dropped (false) and never lands on the new claim's row.
   */
  markDone(row: WebhookEventRow, outcome: WebhookOutcome, processedAt: Date): Promise<boolean>;
  markDead(row: WebhookEventRow, lastError: string, processedAt: Date): Promise<boolean>;
  release(row: WebhookEventRow, write: ReleaseWrite): Promise<boolean>;
  /** Retention: deletes `done` rows processed before `doneBefore` and `dead` rows processed before `deadBefore`. */
  purge(cutoffs: { doneBefore: Date; deadBefore: Date }): Promise<{ done: number; dead: number }>;
}

/** What the handlers need from Strava. Real version: supabaseAdapters.ts (createStravaApi). The worker itself never calls it. */
export interface StravaApi {
  /** getValidAccessToken: ok | not_connected | refresh_failed | no_refresh_token. */
  getAccessToken(userId: string): Promise<AccessTokenResult>;
  /** One GET /activities/:id; the status and, on 200, the body. */
  fetchActivity(accessToken: string, activityId: number): Promise<StravaResponse>;
  /** One GET /athlete, the check behind a deauthorize event (only the status matters). */
  fetchAthlete(accessToken: string): Promise<StravaResponse>;
}

export interface RunStore {
  /** The run with (user_id, external_id), whatever its source, with every column of ExistingRun; null when there is none. */
  findRun(userId: string, externalId: string): Promise<ExistingRun | null>;
  /** The date of the user's earliest run ('YYYY-MM-DD'), or null when the user has none. */
  earliestRunDate(userId: string): Promise<string | null>;
}

export interface Recompute {
  /** reprocessRunsFromDate: streak and XP from this date on. Throws on failure. */
  reprocessFrom(userId: string, fromDate: string): Promise<void>;
  /** calculateUserTotals: totals, level, badges, titles. */
  recalculateTotals(userId: string): Promise<void>;
}

/** Strava's read budget as the worker uses it (stravaRateBudget implements it). */
export interface RateBudget {
  isOverSoftLimit(): boolean;
  nextResumeAt(): Date;
}
