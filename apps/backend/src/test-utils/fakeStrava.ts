/**
 * Testharness för Strava: händelsefabriker och en fetch-stub som svarar som Strava (ADR 010 beslut 17).
 *
 * Bara för tester. Mappen importeras aldrig av server.ts och hamnar därför aldrig i esbuild-paketet; det prövar
 * isolationstestet i __tests__/fakeStrava.test.ts. Den är oberoende av createFakeDb (routes/__tests__/helpers) och
 * kombineras med den i samma test: databasen via fakeDb, nätverket via installFakeStravaFetch.
 *
 * Inget test når nätet: en URL (eller metod) som inte är konfigurerad kastar och listas i `unmockedRequests`,
 * och `restore()` kastar om något sådant anrop skett, även om anropskoden svalde felet.
 *
 * Skyddet gäller bara tester som installerar fejken, och bara om `restore()` körs i `afterEach` (annars ligger stubben kvar
 * för nästa test och omockade anrop upptäcks aldrig). Endast https://www.strava.com matchas; allt annat är omockat.
 */

// ─── Payloads ───────────────────────────────────────────────────────────────

export type StravaObjectType = 'activity' | 'athlete';
export type StravaAspectType = 'create' | 'update' | 'delete';

/** Webhook-händelsen som Strava POST:ar (ADR 010, externa fakta b). Heltal överallt, event_time i epoch-sekunder. */
export interface StravaEventPayload {
  object_type: StravaObjectType;
  aspect_type: StravaAspectType;
  object_id: number;
  owner_id: number;
  subscription_id: number;
  event_time: number;
  /** Bara ändrade fält (`title`, `type`, `private`), eller `authorized: 'false'` på en athlete-händelse. */
  updates: Record<string, string>;
}

export const FAKE_STRAVA_DEFAULTS = {
  ownerId: 5001,
  objectId: 9001,
  subscriptionId: 777,
  eventTime: 1_760_000_000,
} as const;

export function stravaEvent(overrides: Partial<StravaEventPayload> = {}): StravaEventPayload {
  return {
    object_type: 'activity',
    aspect_type: 'create',
    object_id: FAKE_STRAVA_DEFAULTS.objectId,
    owner_id: FAKE_STRAVA_DEFAULTS.ownerId,
    subscription_id: FAKE_STRAVA_DEFAULTS.subscriptionId,
    event_time: FAKE_STRAVA_DEFAULTS.eventTime,
    updates: {},
    ...overrides,
  };
}

/** Deauthorize: en athlete-händelse där objektet är athleten själv (`object_id` = `owner_id`). */
export function stravaDeauthorizeEvent(
  overrides: Partial<Omit<StravaEventPayload, 'object_type' | 'updates'>> = {},
): StravaEventPayload {
  const ownerId = overrides.owner_id ?? FAKE_STRAVA_DEFAULTS.ownerId;
  return stravaEvent({
    aspect_type: 'update',
    object_id: ownerId,
    ...overrides,
    owner_id: ownerId,
    object_type: 'athlete',
    updates: { authorized: 'false' },
  });
}

export type StravaSportType = 'Run' | 'TrailRun' | 'VirtualRun' | 'Ride' | (string & {});

export interface StravaSplit {
  distance: number;
  moving_time: number;
  elapsed_time: number;
  split: number;
}

/** Utdrag av Stravas DetailedActivity: de fält koden läser (extractExtendedFields, isRunningActivity) plus vanliga metadata. */
export interface StravaActivityPayload {
  id: number;
  name: string;
  type: string;
  sport_type: StravaSportType;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  /** UTC. */
  start_date: string;
  /** Väggklocka på startplatsen, men med Z-suffix som hos Strava. */
  start_date_local: string;
  timezone: string;
  private: boolean;
  trainer: boolean;
  manual: boolean;
  athlete: { id: number; resource_state: number };
  start_latlng: [number, number] | null;
  average_heartrate?: number;
  max_heartrate?: number;
  suffer_score?: number;
  splits_metric: StravaSplit[];
}

// Stravas `type` är det gamla fältet: TrailRun rapporteras som Run, övriga har samma värde i båda fälten.
function legacyType(sportType: string): string {
  return sportType === 'TrailRun' ? 'Run' : sportType;
}

function deriveSplits(distance: number, movingTime: number): StravaSplit[] {
  if (distance <= 0) return [];
  const splits: StravaSplit[] = [];
  let remainingTime = movingTime;
  for (let start = 0, index = 1; start < distance; start += 1000, index++) {
    const length = Math.min(1000, distance - start);
    const isLast = start + 1000 >= distance;
    const time = isLast ? remainingTime : Math.round((movingTime * length) / distance);
    remainingTime -= time;
    splits.push({ distance: length, moving_time: time, elapsed_time: time, split: index });
  }
  return splits;
}

export function stravaActivity(overrides: Partial<StravaActivityPayload> = {}): StravaActivityPayload {
  const sportType = overrides.sport_type ?? 'Run';
  const distance = overrides.distance ?? 5000;
  const movingTime = overrides.moving_time ?? 1500;
  const startDateLocal = overrides.start_date_local ?? '2026-10-12T07:30:00Z';
  return {
    id: 1_000_001,
    name: 'Morning Run',
    type: legacyType(sportType),
    sport_type: sportType,
    distance,
    moving_time: movingTime,
    elapsed_time: movingTime + 30,
    total_elevation_gain: 24,
    start_date: overrides.start_date_local ? startDateLocal : '2026-10-12T05:30:00Z',
    start_date_local: startDateLocal,
    timezone: '(GMT+01:00) Europe/Stockholm',
    private: false,
    trainer: false,
    manual: false,
    athlete: { id: FAKE_STRAVA_DEFAULTS.ownerId, resource_state: 1 },
    start_latlng: [59.3293, 18.0686],
    splits_metric: deriveSplits(distance, movingTime),
    ...overrides,
  };
}

export interface StravaAthletePayload {
  id: number;
  username: string;
  firstname: string;
  lastname: string;
  resource_state: number;
}

export function stravaAthlete(overrides: Partial<StravaAthletePayload> = {}): StravaAthletePayload {
  return {
    id: FAKE_STRAVA_DEFAULTS.ownerId,
    username: 'fake_runner',
    firstname: 'Fake',
    lastname: 'Runner',
    resource_state: 2,
    ...overrides,
  };
}

export interface StravaTokenPayload {
  token_type: 'Bearer';
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  /** Finns bara i svaret på kodutbytet, inte vid förnyelse. */
  athlete?: Partial<StravaAthletePayload>;
}

export function stravaTokenResponse(overrides: Partial<StravaTokenPayload> = {}): StravaTokenPayload {
  return {
    token_type: 'Bearer',
    access_token: 'fake-access-token',
    refresh_token: 'fake-refresh-token',
    expires_at: FAKE_STRAVA_DEFAULTS.eventTime + 21_600,
    expires_in: 21_600,
    ...overrides,
  };
}

export interface StravaSubscriptionPayload {
  id: number;
  resource_state: number;
  application_id: number;
  callback_url: string;
  created_at: string;
  updated_at: string;
}

export function stravaSubscription(overrides: Partial<StravaSubscriptionPayload> = {}): StravaSubscriptionPayload {
  return {
    id: FAKE_STRAVA_DEFAULTS.subscriptionId,
    resource_state: 2,
    application_id: 1234,
    callback_url: 'https://api.example.test/api/strava/webhook',
    created_at: '2026-10-14T08:00:00Z',
    updated_at: '2026-10-14T08:00:00Z',
    ...overrides,
  };
}

// ─── Svar ───────────────────────────────────────────────────────────────────

/** Ett felsvar från Strava (404/401/429/5xx). Skapas med stravaError(). */
export class FakeStravaFailure {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly headers: Record<string, string>,
  ) {}
}

const DEFAULT_ERROR_BODIES: Record<number, unknown> = {
  401: { message: 'Authorization Error', errors: [{ resource: 'Athlete', field: 'access_token', code: 'invalid' }] },
  404: { message: 'Resource Not Found', errors: [{ resource: 'Activity', field: 'id', code: 'not found' }] },
  429: { message: 'Rate Limit Exceeded', errors: [{ resource: 'Application', field: 'read rate limit', code: 'exceeded' }] },
};

export function stravaError(status: number, options: { body?: unknown; headers?: Record<string, string> } = {}): FakeStravaFailure {
  const body = 'body' in options ? options.body : (DEFAULT_ERROR_BODIES[status] ?? { message: 'Internal Server Error' });
  return new FakeStravaFailure(status, body, options.headers ?? {});
}

export type FakeStravaRouteName =
  | 'activity'
  | 'athlete'
  | 'athleteActivities'
  | 'pushSubscriptionsList'
  | 'pushSubscriptionsCreate'
  | 'pushSubscriptionsDelete'
  | 'oauthToken'
  | 'oauthDeauthorize';

export interface FakeStravaCall {
  route: FakeStravaRouteName;
  method: string;
  url: string;
  /** Frågeparametrar som strängar. */
  query: Record<string, string>;
  /** Rubriker med gemena namn. */
  headers: Record<string, string>;
  /** JSON-tolkad (eller form-kodad) brödtext; ren sträng om den varken är JSON eller form. */
  body: unknown;
  /** Antal anrop mot den här routen, detta inräknat (1 för första anropet). */
  count: number;
  /** Bara för `activity`. */
  activityId?: number;
}

/** Ett routesvar: data, ett felsvar, eller en funktion som väljer per anrop (t.ex. 401 första gången, sedan data). */
export type FakeStravaRouteValue<T> = T | FakeStravaFailure | ((call: FakeStravaCall) => T | FakeStravaFailure);

/** Användning ur `X-ReadRateLimit-*` / `X-RateLimit-*`: [15-minutersfönstret, dygnet]. */
export interface FakeStravaRateLimitPair {
  usage: [number, number];
  /** Default: appens gränser enligt ADR 010 (läs 300/3 000, totalt 600/6 000). */
  limit?: [number, number];
}

export interface FakeStravaRoutes {
  /** Per aktivitets-id. Ett id som saknas svarar 404; saknas hela `activities` är routen omockad. */
  activities?: Record<string | number, FakeStravaRouteValue<StravaActivityPayload>>;
  athlete?: FakeStravaRouteValue<StravaAthletePayload>;
  /** Listan filtreras på `after`/`before` (epoch-sekunder) och `page`/`per_page`, och saknar splits_metric som Stravas sammanfattning. */
  athleteActivities?: FakeStravaRouteValue<StravaActivityPayload[]>;
  pushSubscriptions?: {
    list?: FakeStravaRouteValue<StravaSubscriptionPayload[]>;
    create?: FakeStravaRouteValue<{ id: number }>;
    /** Svarar 204 utan brödtext. */
    delete?: FakeStravaRouteValue<null>;
  };
  /** Kodutbyte och förnyelse delar route, precis som hos Strava. */
  oauthToken?: FakeStravaRouteValue<StravaTokenPayload>;
  oauthDeauthorize?: FakeStravaRouteValue<{ access_token: string }>;
  /** Läggs på varje svar, även felsvar. Utelämnad = inga rate limit-rubriker. */
  rateLimit?: { read?: FakeStravaRateLimitPair; overall?: FakeStravaRateLimitPair };
}

export interface UnmockedRequest {
  method: string;
  url: string;
}

export interface FakeStrava {
  /** Antal anrop per route. */
  calls: Record<FakeStravaRouteName, number>;
  /** Antal anrop mot `activities/:id` för ett visst id (även okända id:n). */
  activityCalls(id: number | string): number;
  /** Alla mockade anrop i ordning. */
  requests: FakeStravaCall[];
  /** Anrop som inte matchade någon konfigurerad route; de kastade. */
  unmockedRequests: UnmockedRequest[];
  /** Återställer fetch. Kastar om något anrop var omockat, så att ett svalt fel ändå fäller testet. Idempotent. */
  restore(): void;
}

const READ_LIMIT: [number, number] = [300, 3000];
const OVERALL_LIMIT: [number, number] = [600, 6000];

function rateLimitHeaders(config: FakeStravaRoutes['rateLimit']): Record<string, string> {
  const headers: Record<string, string> = {};
  if (config?.read) {
    headers['X-ReadRateLimit-Usage'] = config.read.usage.join(',');
    headers['X-ReadRateLimit-Limit'] = (config.read.limit ?? READ_LIMIT).join(',');
  }
  if (config?.overall) {
    headers['X-RateLimit-Usage'] = config.overall.usage.join(',');
    headers['X-RateLimit-Limit'] = (config.overall.limit ?? OVERALL_LIMIT).join(',');
  }
  return headers;
}

const ROUTE_NAMES: FakeStravaRouteName[] = [
  'activity',
  'athlete',
  'athleteActivities',
  'pushSubscriptionsList',
  'pushSubscriptionsCreate',
  'pushSubscriptionsDelete',
  'oauthToken',
  'oauthDeauthorize',
];

interface Matched {
  route: FakeStravaRouteName;
  value: FakeStravaRouteValue<unknown>;
  successStatus: number;
  activityId?: number;
}

function match(routes: FakeStravaRoutes, method: string, url: URL): Matched | 'unconfigured' | null {
  if (url.protocol !== 'https:' || url.hostname !== 'www.strava.com') return null;
  const pathname = url.pathname.replace(/\/+$/, '');
  const found = (route: FakeStravaRouteName, value: unknown, successStatus = 200, activityId?: number): Matched | 'unconfigured' =>
    value === undefined ? 'unconfigured' : { route, value: value as FakeStravaRouteValue<unknown>, successStatus, activityId };

  const activityMatch = /^\/api\/v3\/activities\/(\d+)$/.exec(pathname);
  if (activityMatch && method === 'GET') {
    const id = Number(activityMatch[1]);
    if (routes.activities === undefined) return 'unconfigured';
    // Okänt id = 404, som när Strava inte har aktiviteten (raderad eller aldrig funnits).
    return found('activity', routes.activities[id] ?? stravaError(404), 200, id);
  }
  if (pathname === '/api/v3/athlete' && method === 'GET') return found('athlete', routes.athlete);
  if (pathname === '/api/v3/athlete/activities' && method === 'GET') return found('athleteActivities', routes.athleteActivities);
  if (pathname === '/api/v3/push_subscriptions' && method === 'GET') return found('pushSubscriptionsList', routes.pushSubscriptions?.list);
  if (pathname === '/api/v3/push_subscriptions' && method === 'POST') {
    return found('pushSubscriptionsCreate', routes.pushSubscriptions?.create, 201);
  }
  if (/^\/api\/v3\/push_subscriptions\/\d+$/.test(pathname) && method === 'DELETE') {
    return found('pushSubscriptionsDelete', routes.pushSubscriptions?.delete, 204);
  }
  if (pathname === '/oauth/token' && method === 'POST') return found('oauthToken', routes.oauthToken);
  if (pathname === '/oauth/deauthorize' && method === 'POST') return found('oauthDeauthorize', routes.oauthDeauthorize);
  return null;
}

function parseBody(body: BodyInit | null | undefined): unknown {
  if (body === undefined || body === null) return undefined;
  if (body instanceof URLSearchParams) return Object.fromEntries(body);
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body);
  } catch {
    return body.includes('=') ? Object.fromEntries(new URLSearchParams(body)) : body;
  }
}

function summaryList(activities: StravaActivityPayload[], query: Record<string, string>): Array<Omit<StravaActivityPayload, 'splits_metric'>> {
  const after = query.after ? Number(query.after) : -Infinity;
  const before = query.before ? Number(query.before) : Infinity;
  const perPage = query.per_page ? Number(query.per_page) : 30;
  const page = query.page ? Number(query.page) : 1;
  return activities
    .filter((activity) => {
      const startedAt = Date.parse(activity.start_date) / 1000;
      return startedAt > after && startedAt < before;
    })
    .slice((page - 1) * perPage, page * perPage)
    .map(({ splits_metric: _splits, ...summary }) => summary);
}

/** Byter globalThis.fetch mot en stub som svarar som Strava. Kalla `restore()` i afterEach. */
export function installFakeStravaFetch(routes: FakeStravaRoutes): FakeStrava {
  const originalFetch = globalThis.fetch;
  const calls = Object.fromEntries(ROUTE_NAMES.map((name) => [name, 0])) as Record<FakeStravaRouteName, number>;
  const perActivity = new Map<number, number>();
  const requests: FakeStravaCall[] = [];
  const unmockedRequests: UnmockedRequest[] = [];
  let restored = false;

  const stub = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : undefined;
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const refuse = (reason: string): never => {
      unmockedRequests.push({ method, url: rawUrl });
      throw new Error(`fakeStrava: unmocked request ${method} ${rawUrl} (${reason}); the test must not reach the network`);
    };

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return refuse('not an absolute url');
    }
    const matched = match(routes, method, url);
    if (matched === null) return refuse('no matching route');
    if (matched === 'unconfigured') return refuse('route not configured');

    const headers = Object.fromEntries(new Headers(init?.headers ?? request?.headers).entries());
    calls[matched.route] += 1;
    if (matched.activityId !== undefined) perActivity.set(matched.activityId, (perActivity.get(matched.activityId) ?? 0) + 1);
    const call: FakeStravaCall = {
      route: matched.route,
      method,
      url: rawUrl,
      query: Object.fromEntries(url.searchParams),
      headers,
      body: parseBody(init?.body),
      count: calls[matched.route],
      ...(matched.activityId !== undefined ? { activityId: matched.activityId } : {}),
    };
    requests.push(call);

    const resolved = typeof matched.value === 'function' ? (matched.value as (c: FakeStravaCall) => unknown)(call) : matched.value;
    const baseHeaders = { ...rateLimitHeaders(routes.rateLimit) };

    if (resolved instanceof FakeStravaFailure) {
      return new Response(JSON.stringify(resolved.body), {
        status: resolved.status,
        headers: { 'Content-Type': 'application/json', ...baseHeaders, ...resolved.headers },
      });
    }
    if (matched.successStatus === 204) return new Response(null, { status: 204, headers: baseHeaders });
    const payload = matched.route === 'athleteActivities' ? summaryList(resolved as StravaActivityPayload[], call.query) : resolved;
    return new Response(JSON.stringify(payload), {
      status: matched.successStatus,
      headers: { 'Content-Type': 'application/json', ...baseHeaders },
    });
  };

  globalThis.fetch = stub as typeof fetch;

  return {
    calls,
    activityCalls: (id) => perActivity.get(Number(id)) ?? 0,
    requests,
    unmockedRequests,
    restore() {
      if (restored) return;
      restored = true;
      globalThis.fetch = originalFetch;
      if (unmockedRequests.length > 0) {
        throw new Error(
          `fakeStrava: ${unmockedRequests.length} unmocked request(s): ${unmockedRequests.map((r) => `${r.method} ${r.url}`).join(', ')}`,
        );
      }
    },
  };
}
