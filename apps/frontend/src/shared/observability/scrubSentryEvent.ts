import { isStaleChunkError, isStaleReloadOrdered } from '@/shared/utils/staleChunkReload';
import { isNetworkFailure } from './networkFailure';

// beforeSend för felspårningen: ren funktion utan Sentry-import, så att den testas utan SDK:t och aldrig drar in det i en tidig chunk.
// Princip: rapporten ska säga var och vad som gick sönder, aldrig vem det hände för. Allt som kan identifiera en person (användare,
// namn, e-post, token, adresser med query) tas bort eller maskas innan något lämnar webbläsaren.

const FILTERED = '[Filtered]';
const MAX_DEPTH = 12;
const MIN_STORAGE_VALUE_LENGTH = 6;
const MIN_PII_LEAF_LENGTH = 3;

/** Nycklar (normaliserade: gemener utan _ - mellanslag) vars värden aldrig lämnar webbläsaren. */
const PII_KEYS = new Set([
  'authorization', 'cookie', 'setcookie', 'email', 'name', 'username', 'displayname', 'firstname', 'lastname', 'fullname',
  'password', 'token', 'accesstoken', 'refreshtoken', 'apikey',
]);
/** Delar av händelsen som SDK:t själv fyller med tekniska namn (webbläsare, OS, SDK-paket); där tas bara text maskas, inte nycklar. */
const KEEP_KEYS_IN = new Set(['contexts', 'sdk']);
/**
 * SDK:ts egen metadata på toppnivå (sätts i prepareEvent före beforeSend): bygget och miljön, händelsens id, tid och nivå. De passerar orörda,
 * för release matchar annars e-postregexen och källkartorna hittas inte. Varje fält släpps bara igenom i sin kända form; allt annat (ett
 * objekt, en text med mellanslag, ett e-postlikt värde) får nyckeln struken i stället för tvättad. release har ett @ i sin form
 * (runquest@<version>+<sha7>), så mönstret är exakt det och inget bredare; dist har inget @ alls.
 */
/** Releasens enda form. Byggets namn kommer från scripts/sentry-build.mjs; sentryReleasePattern.test.ts låser de två mot varandra. */
export const RELEASE_PATTERN = /^runquest@\d+\.\d+\.\d+(\.\d+)?(\+[0-9a-f]{7})?$/;

const SDK_METADATA_VALID: Record<string, (value: unknown) => boolean> = {
  release: (value) => typeof value === 'string' && RELEASE_PATTERN.test(value),
  dist: (value) => typeof value === 'string' && /^[\w.-]{1,64}$/.test(value),
  environment: (value) => typeof value === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(value),
  event_id: (value) => typeof value === 'string' && /^[0-9a-f]{32}$/i.test(value),
  platform: (value) => typeof value === 'string' && /^[a-z]{1,32}$/.test(value),
  level: (value) => typeof value === 'string' && ['fatal', 'error', 'warning', 'log', 'info', 'debug'].includes(value),
  timestamp: (value) => typeof value === 'number' && Number.isFinite(value),
};
/** Fler bilder än så har ingen frontendbunt; taket hindrar att debug_meta blir en stor last. */
const MAX_DEBUG_IMAGES = 200;
/** Brödsmulor som kan bära inskriven text eller visningsnamn: konsolrader och klick/inmatning i gränssnittet. */
const DROPPED_BREADCRUMB_CATEGORY = /^(console|ui\..*)$/;

const EMAIL = /[^\s@"'<>()]+@[^\s@"'<>()]+\.[^\s@"'<>()]+/g;
// Sökväg eller adress följd av ?query (och eventuell #fragment). Ett fritt frågetecken i en mening ("Why? Because") träffas inte.
const URL_QUERY = /([\w\-./:%~]+)\?[\w%\-.~!$&'()*+,;=:@/[\]]+(#\S*)?/g;
// Fragmentet efter en adress eller en sökväg som börjar med / ("/board#x"); ett # i vanlig text ("issue #12") berörs inte.
const URL_HASH = /(https?:\/\/[^\s#]+|\/[\w\-./%~]*)#\S*/g;

// Id:n i adresser (UUID och rena tal) blir :id, samma princip som sidnamnen i Umami: sökvägen visar vilken sorts anrop det var, inte vems.
const ID_PLACEHOLDER = ':id';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// En adress eller en sökväg som börjar med / (inte mitt i ett ord eller ett datum som 2026/10/17).
const PATH_TOKEN = /https?:\/\/[^\s"'<>()]+|(?<![\w/])\/[^\s"'<>()]*/g;
const NUMERIC_SEGMENT = /(?<=\/)\d+(?=\/|$)/g;
// Debug-id:t som kopplar ett skript till dess källkarta: ett heltäckande UUID, och därför inte ett värde som får bli :id.
const DEBUG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeIds(text: string): string {
  return text
    .replace(UUID, ID_PLACEHOLDER)
    .replace(PATH_TOKEN, (path) => path.replace(NUMERIC_SEGMENT, ID_PLACEHOLDER));
}

interface Breadcrumb {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface SentryEventLike {
  message?: string;
  user?: unknown;
  request?: {
    url?: string;
    query_string?: unknown;
    cookies?: unknown;
    data?: unknown;
    headers?: Record<string, string>;
  };
  exception?: { values?: Array<{ type?: string; value?: string }> };
  extra?: Record<string, unknown>;
  breadcrumbs?: Breadcrumb[];
  contexts?: unknown;
  sdk?: unknown;
  tags?: unknown;
  release?: string;
  debug_meta?: unknown;
}

type StorageLike = Pick<Storage, 'length' | 'key' | 'getItem'>;

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[_\-\s]/g, '');
const isPiiKey = (key: string): boolean => PII_KEYS.has(normalizeKey(key));
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function collectPiiLeaves(value: unknown, insidePiiKey: boolean, into: Set<string>, depth = 0): void {
  if (depth > MAX_DEPTH) return;
  if (typeof value === 'string') {
    if (insidePiiKey && value.length >= MIN_PII_LEAF_LENGTH) into.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPiiLeaves(item, insidePiiKey, into, depth + 1);
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) collectPiiLeaves(child, insidePiiKey || isPiiKey(key), into, depth + 1);
  }
}

/**
 * Värden som ligger i localStorage (token, inloggad användare) och därför aldrig får stå i en rapport. Hela värdet tas med, och för
 * lagrad JSON även namn/e-post-fälten för sig, så att ett namn som hamnat i ett felmeddelande maskas. Längst först, så att ett långt
 * värde maskas hel innan en kortare del av det hinner göra det.
 */
export function collectStorageValues(storage: StorageLike): string[] {
  const values = new Set<string>();
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      const raw = key === null ? null : storage.getItem(key);
      if (!raw) continue;
      if (raw.length >= MIN_STORAGE_VALUE_LENGTH) values.add(raw);
      if (raw.startsWith('{') || raw.startsWith('[')) {
        try {
          collectPiiLeaves(JSON.parse(raw), false, values);
        } catch {
          // Inte JSON trots klammern: hela värdet är redan med.
        }
      }
    }
  } catch {
    return [];
  }
  return [...values].sort((a, b) => b.length - a.length);
}

function scrubString(text: string, storageValues: readonly string[]): string {
  let result = text;
  for (const value of storageValues) result = result.split(value).join(FILTERED);
  // Adressernas query först: en e-post inne i en query ska försvinna med den, inte dra med sig resten av adressen.
  result = result.replace(URL_QUERY, '$1').replace(URL_HASH, '$1');
  return normalizeIds(result).replace(EMAIL, FILTERED);
}

function scrubValue(value: unknown, storageValues: readonly string[], keepKeys: boolean, depth: number): unknown {
  if (typeof value === 'string') return scrubString(value, storageValues);
  if (depth > MAX_DEPTH) return FILTERED;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, storageValues, keepKeys, depth + 1));
  if (!isPlainObject(value)) return value;
  const scrubbed: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (!keepKeys && isPiiKey(key)) continue;
    scrubbed[key] = scrubValue(child, storageValues, keepKeys, depth + 1);
  }
  return scrubbed;
}

/**
 * debug_meta byggs om i stället för att släppas igenom: bara de bilder SDK:t skapar för källkartor (type, debug_id, code_file) och bara om
 * debug_id verkligen är ett UUID. code_file är en adress och tvättas som alla andra. Allt annat i debug_meta kastas.
 */
function rebuildDebugMeta(value: unknown, storageValues: readonly string[]): { images: Array<Record<string, string>> } | null {
  if (!isPlainObject(value) || !Array.isArray(value.images)) return null;
  const images: Array<Record<string, string>> = [];
  for (const image of value.images.slice(0, MAX_DEBUG_IMAGES)) {
    if (!isPlainObject(image) || typeof image.debug_id !== 'string' || !DEBUG_ID.test(image.debug_id)) continue;
    const rebuilt: Record<string, string> = { debug_id: image.debug_id };
    if (image.type === 'sourcemap') rebuilt.type = image.type;
    if (typeof image.code_file === 'string') rebuilt.code_file = scrubString(image.code_file, storageValues);
    images.push(rebuilt);
  }
  return { images };
}

function isUnreportableEvent(event: SentryEventLike): boolean {
  if (isStaleReloadOrdered()) return true;
  if (event.message && (isStaleChunkError(event.message) || isNetworkFailure(event.message))) return true;
  return (event.exception?.values ?? []).some((entry) => isStaleChunkError(entry.value ?? '') || isNetworkFailure(entry.value ?? ''));
}

/**
 * Tvättar en händelse före sändning. Returnerar null för fel som inte ska rapporteras: saknad kodfil efter deploy (en omladdning löser det) och anrop utan svar (backend nere). Ändrar aldrig
 * indata. `storageValues` är det `collectStorageValues` gav vid sändningstillfället.
 */
export function scrubSentryEvent<T extends SentryEventLike>(event: T, storageValues: readonly string[]): T | null {
  if (isUnreportableEvent(event)) return null;

  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (key === 'user') continue;
    if (Object.prototype.hasOwnProperty.call(SDK_METADATA_VALID, key)) {
      if (SDK_METADATA_VALID[key]?.(value)) scrubbed[key] = value;
      continue;
    }
    if (key === 'debug_meta') {
      const debugMeta = rebuildDebugMeta(value, storageValues);
      if (debugMeta) scrubbed[key] = debugMeta;
      continue;
    }
    if (key === 'breadcrumbs' && Array.isArray(value)) {
      scrubbed[key] = (value as Breadcrumb[])
        .filter((crumb) => !DROPPED_BREADCRUMB_CATEGORY.test(crumb.category ?? ''))
        .map((crumb) => scrubValue(crumb, storageValues, false, 1));
      continue;
    }
    scrubbed[key] = scrubValue(value, storageValues, KEEP_KEYS_IN.has(key), 1);
  }

  const request = scrubbed.request;
  if (isPlainObject(request)) {
    delete request.query_string;
    delete request.cookies;
    delete request.data;
  }
  return scrubbed as T;
}
