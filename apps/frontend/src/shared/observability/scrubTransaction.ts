import { routeNameOf } from './routeNames';
import { scrubSentryEvent, type SentryEventLike } from './scrubSentryEvent';

// Rensning av prestandaspårningen (RUN-287), motsvarigheten till scrubSentryEvent för fel. Ren funktion utan Sentry-import.
//
// Det Sentry skickar för en sidladdning (verifierat mot @sentry/react 11.8) och vad som händer med det:
//  - Namn och adress: den råa sökvägen, med id. Byts mot routenamnet (routeNames.ts).
//  - Delspans: en per resurs (skript, bilder med adress), anrop och långa uppgifter. Skickas inte alls; webbvärdena (LCP, CLS, FCP,
//    TTFB) ligger i `measurements` och behöver dem inte.
//  - Attribut på transaktionen: `url.*`, `lcp.element`/`lcp.url`/`lcp.id` (elementet och bildens adress, t.ex. en avatar) och
//    `cls.source.*` (väljare för elementet som flyttade sig). Bara attributen på listan nedan följer med.
//  - Brödsmulor och användare: skickas inte på en transaktion.
//  - INP kommer som en egen span (`ui.interaction.*`) med en väljare för elementet som beskrivning och som attribut; väljaren kan
//    bära visningsnamn (aria-label). Den får ett fast namn och bara värdet, typen och webbläsaren följer med.

export const INTERACTION_SPAN_NAME = 'Interaction to next paint';

/** Attribut som får följa med: hur och när sidan laddades, vilken webbläsare, och INP-värdet. Inget om vem eller var. */
const KEPT_ATTRIBUTES = new Set([
  'sentry.op', 'sentry.origin', 'sentry.sample_rate', 'sentry.segment.name.source', 'sentry.idle_span_finish_reason',
  'sentry.exclusive_time', 'sentry.segment.name', 'sentry.segment.id', 'sentry.environment', 'sentry.release',
  'sentry.sdk.name', 'sentry.sdk.version',
  'performance.timeOrigin', 'performance.activationStart', 'browser.navigation.type',
  'browser.web_vital.inp.value', 'browser.web_vital.inp.interaction_type',
  'user_agent.original',
]);
const SEGMENT_NAME = 'sentry.segment.name';

type Attributes = Record<string, unknown>;

function keptAttributes(data: unknown): Attributes {
  const kept: Attributes = {};
  if (data === null || typeof data !== 'object') return kept;
  for (const [key, value] of Object.entries(data as Attributes)) {
    if (!KEPT_ATTRIBUTES.has(key) || value === undefined) continue;
    kept[key] = key === SEGMENT_NAME && typeof value === 'string' ? routeNameOf(value) : value;
  }
  return kept;
}

/** Det av en SpanJSON som funktionen läser. */
export interface SpanJsonLike {
  op?: string;
  description?: string;
  data?: object;
}

/**
 * `beforeSendSpan` (statisk): en rensad kopia av spanen. Beskrivningen blir routenamnet, ett fast namn eller bara typen.
 * En interaktion (INP) har inget sidladdnings-span att ärva sidnamn från; saknar den ett får den `fallbackRoute`, namnet på sidan
 * som är öppen när spanen skickas (besökets sista sida).
 */
export function scrubSpanJson<T extends SpanJsonLike>(span: T, fallbackRoute?: string): T {
  const op = span.op ?? '';
  const isInteraction = op.startsWith('ui.interaction');
  const description = op === 'pageload' ? routeNameOf(span.description ?? '') : isInteraction ? INTERACTION_SPAN_NAME : op || 'span';
  const data = keptAttributes(span.data);
  if (isInteraction && fallbackRoute !== undefined && data[SEGMENT_NAME] === undefined) data[SEGMENT_NAME] = routeNameOf(fallbackRoute);
  return { ...span, description, data } as T;
}

const USER_AGENT = 'user-agent';

/**
 * `beforeSendTransaction`: en rensad kopia av sidladdningen, eller null för det som inte ska rapporteras (samma regler som felen:
 * saknad kodfil efter deploy, backend nere). Ändrar aldrig indata. Namnet blir routenamnet.
 */
export function scrubTransaction<T extends SentryEventLike>(event: T, storageValues: readonly string[]): T | null {
  const scrubbed = scrubSentryEvent(event, storageValues) as (T & { transaction?: string; spans?: unknown[]; measurements?: unknown }) | null;
  if (!scrubbed) return null;

  const name = routeNameOf(scrubbed.transaction ?? '');
  const out: Record<string, unknown> = { ...(scrubbed as object), transaction: name, transaction_info: { source: 'route' }, spans: [] };
  delete out.breadcrumbs;
  delete out.user;

  const contexts = scrubbed.contexts as { trace?: { data?: unknown } } | undefined;
  if (contexts && typeof contexts === 'object') {
    out.contexts = contexts.trace ? { ...contexts, trace: { ...contexts.trace, data: keptAttributes(contexts.trace.data) } } : contexts;
  }

  const request = scrubbed.request;
  const headers = Object.entries(request?.headers ?? {}).filter(([key]) => key.toLowerCase() === USER_AGENT);
  let origin = '';
  try {
    origin = request?.url ? new URL(request.url).origin : '';
  } catch {
    origin = '';
  }
  out.request = { ...(origin ? { url: `${origin}${name}` } : {}), ...(headers.length > 0 ? { headers: Object.fromEntries(headers) } : {}) };

  return out as T;
}
