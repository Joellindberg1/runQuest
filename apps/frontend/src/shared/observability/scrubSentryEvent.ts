import { isStaleChunkError } from '@/shared/utils/staleChunkReload';

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
/** Brödsmulor som kan bära inskriven text eller visningsnamn: konsolrader och klick/inmatning i gränssnittet. */
const DROPPED_BREADCRUMB_CATEGORY = /^(console|ui\..*)$/;

const EMAIL = /[^\s@"'<>()]+@[^\s@"'<>()]+\.[^\s@"'<>()]+/g;
// Sökväg eller adress följd av ?query (och eventuell #fragment). Ett fritt frågetecken i en mening ("Why? Because") träffas inte.
const URL_QUERY = /([\w\-./:%~]+)\?[\w%\-.~!$&'()*+,;=:@/[\]]+(#\S*)?/g;
const URL_HASH = /(https?:\/\/[^\s#]+)#\S*/g;

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
  return result.replace(URL_QUERY, '$1').replace(URL_HASH, '$1').replace(EMAIL, FILTERED);
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

function isStaleChunkEvent(event: SentryEventLike): boolean {
  if (event.message && isStaleChunkError(event.message)) return true;
  return (event.exception?.values ?? []).some((entry) => isStaleChunkError(entry.value ?? ''));
}

/**
 * Tvättar en händelse före sändning. Returnerar null för fel som en omladdning efter deploy löser (saknad kodfil). Ändrar aldrig
 * indata. `storageValues` är det `collectStorageValues` gav vid sändningstillfället.
 */
export function scrubSentryEvent<T extends SentryEventLike>(event: T, storageValues: readonly string[]): T | null {
  if (isStaleChunkEvent(event)) return null;

  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (key === 'user') continue;
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
