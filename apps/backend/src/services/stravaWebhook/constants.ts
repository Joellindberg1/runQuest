// Strava-webhookens händelselager: listor och konstanter på ETT ställe (ADR 010 beslut 5 och 6), på samma sätt som
// ACTIVITY_TYPES i ADR 008. Listorna här är exakt de som migration 046 har i sina CHECK-satser (statiskt test:
// stravaWebhookMigration046.test.ts) och som ADR 010 beslut 7 räknar upp (stravaWebhookEvents.test.ts).

/** Händelsens tillstånd i kön. `dead` = äldre än WEBHOOK_DEAD_AFTER_HOURS utan att lyckas (larmar, ADR 010 beslut 11). */
export const WEBHOOK_STATUSES = ['pending', 'processing', 'done', 'dead'] as const;
export type WebhookStatus = (typeof WEBHOOK_STATUSES)[number];

export const WEBHOOK_OBJECT_TYPES = ['activity', 'athlete'] as const;
export type WebhookObjectType = (typeof WEBHOOK_OBJECT_TYPES)[number];

export const WEBHOOK_ASPECT_TYPES = ['create', 'update', 'delete'] as const;
export type WebhookAspectType = (typeof WEBHOOK_ASPECT_TYPES)[number];

/** De enda nycklar i Stravas `updates` som lagras. `title` hör aldrig hit (dataminimering, ADR 010 beslut 1 och 5). */
export const WEBHOOK_UPDATE_KEYS = ['private', 'type', 'authorized'] as const;
export type WebhookUpdateKey = (typeof WEBHOOK_UPDATE_KEYS)[number];

/**
 * Hur en bearbetad händelse slutade (kolumnen `outcome`). Ingen CHECK i databasen: ett nytt utfall ska inte kräva en
 * migration. Listan är ADR 010 beslut 5:s uppräkning.
 */
export const WEBHOOK_OUTCOMES = [
  'imported',
  'updated',
  'noop',
  'not_a_run',
  'deleted',
  'removed_private',
  'removed_not_running',
  'deauthorized_runs_deleted',
  'ignored_paused',
  'ignored_unknown_owner',
  'ignored_not_confirmed',
] as const;
export type WebhookOutcome = (typeof WEBHOOK_OUTCOMES)[number];

/** Väntan efter 1:a, 2:a, 3:e misslyckade försöket; därefter var 60:e minut (index min(attempts - 1, 3)). */
export const WEBHOOK_BACKOFF_MINUTES = [1, 5, 15, 60] as const;

/** En händelse som inte lyckats efter så här många timmar blir `dead` och larmar. Stravas villkor: raderingar inom 48 h. */
export const WEBHOOK_DEAD_AFTER_HOURS = 48;

/** Hur länge en claimad händelse är låst åt en worker innan den räknas som kraschad (p_lease_seconds). */
export const LEASE_SECONDS = 300;

/** Så många händelser (för en ägare) tar ett claim åt gången (p_max). */
export const WEBHOOK_CLAIM_BATCH = 25;

/** Routens sökväg: ENDA platsen. app.ts monterar på den, prenumerationsskriptets callback-url slutar på den (testat), och loggen visar bara den (aldrig query-strängen). */
export const STRAVA_WEBHOOK_PATH = '/api/strava/webhook';

/** Brödtextens gräns på webhook-rutten (ADR 010 beslut 3.2). Strava skickar några hundra byte; resten är inte Strava. */
export const WEBHOOK_BODY_LIMIT = '10kb';

/** Så många obearbetade rader (pending + processing) en ägare får ha i kön; därefter sparas inga fler (ADR 010 beslut 3.4). */
export const WEBHOOK_MAX_UNPROCESSED_PER_OWNER = 200;

/** Sista tillåtna event_time (epoch-sekunder): 9999-12-31T23:59:59Z. Därefter skriver toISOString() ett sexsiffrigt år som Postgres avvisar (22009). */
export const WEBHOOK_MAX_EVENT_TIME = 253402300799;

// TODO(RUN-261): replace these two with the same-named constants in packages/shared/src/rules.ts once RUN-261 is on the branch.
// The privacy text is built from the shared ones, so the values must stay identical (ADR 010 decision 11).
/** `done` events are deleted this many days after they were processed. */
export const WEBHOOK_RETENTION_DONE_DAYS = 30;
/** `dead` events are deleted this many days after they were declared dead. */
export const WEBHOOK_RETENTION_FAILED_DAYS = 90;

/** The worker sweep: every minute (ADR 010 decision 6). The sweep is the guarantee, the wake-up after an insert is only latency. */
export const WEBHOOK_SWEEP_CRON = '* * * * *';
/** The retention job: 03:30 every night, Europe/Stockholm (ADR 010 decision 11). */
export const WEBHOOK_RETENTION_CRON = '30 3 * * *';

/** A wait for the 15-minute rate limit ends at the next whole quarter hour plus this much (ADR 010 decision 9). */
export const WEBHOOK_QUARTER_WAIT_MARGIN_MS = 30_000;
/** A wait for the daily rate limit ends at the next UTC midnight plus this much (ADR 010 decision 9). */
export const WEBHOOK_DAILY_WAIT_MARGIN_MS = 60_000;

/** `last_error` is a short code, never a message: it is cut at this length as a last guard against a token or a body slipping in. */
export const WEBHOOK_LAST_ERROR_MAX_LENGTH = 80;
