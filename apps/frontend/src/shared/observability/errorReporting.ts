import { isStaleChunkError } from '@/shared/utils/staleChunkReload';

// Felspårningens lätta ingång. Den här filen importerar aldrig Sentry-SDK:t: det ligger i ./sentryClient och hämtas med dynamisk import
// först när det inloggade skalet monterar (enableErrorReporting). Landningen och /legal laddar därför ingen Sentry-kod. Utan
// VITE_SENTRY_DSN händer ingenting alls: ingen chunk hämtas och reportError är en tom funktion.

export type ReportContext = Record<string, unknown>;
type ReportSink = (error: unknown, context?: ReportContext) => void;

export interface ReportingEnv {
  VITE_SENTRY_DSN?: string;
  VITE_SENTRY_ENVIRONMENT?: string;
  MODE?: string;
}

/**
 * Fel som uppstår innan SDK:t startat köas (bara när en DSN är satt) och skickas när det är klart. Det täcker skalets första rendering,
 * där ErrorBoundary fångar felet före skalets effekt som startar spårningen, och tiden medan chunken hämtas. Fel från landningen
 * köas på samma sätt men skickas först om användaren loggar in i samma sidladdning; landningen själv skickar aldrig något. Kön är
 * liten och släpper de äldsta först, så minnet växer aldrig av en felloop.
 */
const MAX_QUEUED = 20;

let sink: ReportSink | null = null;
let startRequested = false;
let failed = false;
const queue: Array<{ error: unknown; context?: ReportContext }> = [];

// Namngivna fält i stället för hela import.meta.env, som Vite annars bakar in som ett objekt.
const readEnv = (): ReportingEnv => ({
  VITE_SENTRY_DSN: import.meta.env.VITE_SENTRY_DSN,
  VITE_SENTRY_ENVIRONMENT: import.meta.env.VITE_SENTRY_ENVIRONMENT,
  MODE: import.meta.env.MODE,
});
const dsnOf = (env: ReportingEnv): string | undefined => env.VITE_SENTRY_DSN?.trim() || undefined;

/** Rapporterar ett fel om felspårningen är påslagen. Kastar aldrig. Omladdningsfel efter deploy (saknad kodfil) rapporteras inte. */
export function reportError(error: unknown, context?: ReportContext): void {
  if (failed || isStaleChunkError(error)) return;
  if (sink) {
    sink(error, context);
    return;
  }
  if (!dsnOf(readEnv())) return;
  queue.push({ error, context });
  if (queue.length > MAX_QUEUED) queue.shift();
}

/** Startar felspårningen en gång, om en DSN är satt. Anropas när det inloggade skalet monterar. Ett misslyckat SDK-start tystas: appen går före. */
export async function enableErrorReporting(env: ReportingEnv = readEnv()): Promise<void> {
  const dsn = dsnOf(env);
  if (!dsn || startRequested) return;
  startRequested = true;
  try {
    const { startSentry } = await import('./sentryClient');
    sink = startSentry({ dsn, environment: env.VITE_SENTRY_ENVIRONMENT?.trim() || env.MODE || 'production' });
  } catch (error) {
    console.warn('Error tracking could not start', error);
    failed = true;
    queue.length = 0;
    return;
  }
  for (const { error, context } of queue.splice(0)) sink(error, context);
}
