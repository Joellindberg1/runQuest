/**
 * Kritiska larm: en `logger.error`-rad med prefixet "🚨 KRITISK" (KRITISKT, och den äldre stavningen KRITISK) ska bli en Sentry-händelse
 * med level `fatal` och taggen `alert=critical` (observability/sentry.ts, captureLoggedError, är den enda platsen som gör det).
 *
 * Källkoden går med som ett sista argument till loggraden: `logger.error('🚨 KRITISKT: ...', new CriticalAlert('token_write'))`.
 * Den hamnar också i loggraden som `{"source":"token_write"}`, så Railway-loggen går att filtrera på samma kod som Sentry.
 * Loggern känner inte till Sentry; den här filen har inga beroenden.
 *
 * Taggar får aldrig bära Strava-id, namn eller tokens (ADR 010 beslut 8.6): bara källkoden och vårt eget user_id.
 */
export const CRITICAL_ALERT_PREFIX = '🚨 KRITISK';

/** En kort, stabil kod per larmkälla; det är den Sentry-alertregeln och Railway-filtret använder. */
export const CRITICAL_ALERT_SOURCES = [
  /** En Strava-webhook-händelse blev `dead` efter 48 h (stravaWebhookWorker). */
  'webhook_dead',
  /** Dygnskontrollen hittar ingen, eller fel, prenumeration hos Strava (stravaWebhook/subscriptionCheck). */
  'subscription_missing',
  /** En roterad Strava-token kunde inte sparas (stravaClient.refreshStravaToken). */
  'token_write',
  /** Nyckeln för tokenkryptering saknas, är ogiltig eller godtas inte i miljön vid uppstart (services/tokenKeyStartup, ADR 013). Strava-synken är då avstängd. */
  'token_key',
  /** En avgjord utmaning har inga boostar och kunde inte släppas, eller spelarna kunde inte låsas upp (challengeService). */
  'challenge_repair',
] as const;

export type CriticalAlertSource = (typeof CRITICAL_ALERT_SOURCES)[number];

/** Källkod för en rad som har prefixet men ingen `CriticalAlert` med. */
export const UNKNOWN_CRITICAL_SOURCE = 'unknown';

export class CriticalAlert {
  readonly source: CriticalAlertSource;
  /** Vårt eget användar-id, om larmet gäller en användare. Aldrig ett Strava-id. */
  readonly userId?: string;

  /**
   * Texten som Sentry-händelsen får i stället för loggraden (meddelande, gruppering och undantagskontext), byggd av anroparen utan
   * Strava-id. Loggraden i Railway är oförändrad. Inte uppräkningsbar, så den hamnar inte i loggradens kontext.
   */
  readonly sentryMessage?: string;

  constructor(source: CriticalAlertSource, options: { userId?: string; sentryMessage?: string } = {}) {
    this.source = source;
    if (options.userId) this.userId = options.userId;
    if (options.sentryMessage) Object.defineProperty(this, 'sentryMessage', { value: options.sentryMessage, enumerable: false });
  }
}

export interface CriticalAlertInfo {
  source: CriticalAlertSource | typeof UNKNOWN_CRITICAL_SOURCE;
  userId?: string;
  sentryMessage?: string;
}

/** Är loggraden ett kritiskt larm? Prefixet eller en `CriticalAlert` bland argumenten räcker. */
export function criticalAlertOf(message: string, args: readonly unknown[]): CriticalAlertInfo | null {
  const marker = args.find((a): a is CriticalAlert => a instanceof CriticalAlert);
  if (marker) {
    return {
      source: marker.source,
      ...(marker.userId ? { userId: marker.userId } : {}),
      ...(marker.sentryMessage ? { sentryMessage: marker.sentryMessage } : {}),
    };
  }
  return message.startsWith(CRITICAL_ALERT_PREFIX) ? { source: UNKNOWN_CRITICAL_SOURCE } : null;
}
