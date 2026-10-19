import { readFileSync } from 'node:fs';
import type { BrowserContext, Route } from '@playwright/test';
// Svarsformerna är kontraktstyperna ur shared (en relativ sökväg: e2e har inget beroende på paketet). Ändras en form i kontraktet fäller `tsc -p apps/e2e` stuben här.
// Undantag: config/xp (XpConfigApiResponse). Dess fil drar in levelCalculation.ts, som inte klarar e2e:s strängare flaggor (noUncheckedIndexedAccess), så den formen är handskriven efter kontraktet.
import type { OnboardingStatusResponse } from '../../../packages/shared/src/contracts/onboarding';
import type { BadgeGroupApiResponse } from '../../../packages/shared/src/contracts/badges';
import type { RankDeltaApiResponse } from '../../../packages/shared/src/contracts/leaderboard';
import type { PublicStatsApiResponse } from '../../../packages/shared/src/contracts/publicStats';
import type { UserTitlesResponse } from '../../../packages/shared/src/contracts/titles';
import type { CreateRunRequest } from '../../../packages/shared/src/contracts/runs';
import { FIXED_ONBOARDING_SLUGS, patchSlugForVersion } from '../../../packages/shared/src/onboardingSlugs';
import { assertStubApiAllowed } from '../../../scripts/e2e-guard.mjs';
import { targets, userCredentials } from './targets';

/**
 * Fejkat API för körningar mot en lokal frontend (valfritt, av som standard). Mot staging används alltid det riktiga API:et.
 *
 * `E2E_STUB_API=1` slår på det, och bara när både frontenden och API:et är localhost (E2E-vakten): då besvaras alla förfrågningar till API-adressen i webbläsaren
 * med de svar nedan, och inget lämnar maskinen. Det gör att specerna för landningen och laddningsvyn (`tests/landing.spec.ts`) och inloggningen (`login.spec.ts`)
 * kan bevisas mot ett lokalt bygge (`apps/frontend/dist` serverat av repo-rotens Caddyfile) utan staging, konto eller backend. Kontot är det som står i
 * E2E_USER_LOGIN/E2E_USER_PASSWORD; allt annat lösenord ger 401. Svarsformerna är de som routerna i `apps/backend/src/routes` skickar (login, users-with-runs,
 * titles/user, leaderboard/rank-delta, badges/group, onboarding/status, waitlist, runs) eller kontraktstyperna i shared (public/stats, config/xp), bara så mycket som Board, landningen och
 * en loggad runda läser. En körning har ett eget tillstånd (rundorna som loggats), som topplistan svarar med. Specer som läser data via Node-`fetch` (`support/api.ts`) eller kräver nyhetsflödet
 * hoppar över sig själva när stuben är påslagen (`test.skip(apiIsStubbed(), …)`).
 */
export const STUB_ENV_NAME = 'E2E_STUB_API';

export function stubApiRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[STUB_ENV_NAME] === '1';
}

/** Sant när specen kör mot ett lokalt bygge med fejkat API. Aldrig sant mot staging: där fäller stubben själv körningen (installStubApi), så ett hoppat prov kan inte dölja något. */
export function apiIsStubbed(env: NodeJS.ProcessEnv = process.env): boolean {
  return stubApiRequested(env) && targets.isLocal;
}

const STUB_USER = { id: 'stub-user-1', name: 'Stub Runner', email: 'stub-runner@example.test', is_admin: false };
// Ingen JWT-form: ett påhittat värde som inte kan förväxlas med en riktig token.
const STUB_TOKEN = 'stub-session-not-a-real-token';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

const BASE_XP = 1200;
const BASE_KM = 42.5;
// Stubbens XP för en loggad runda: ett påhittat belopp, bara så att totalerna rör sig. Riktig XP räknas av backenden (shared/xpCalculation) och bevisas mot staging.
const STUB_RUN_BASE_XP = 20;
const STUB_RUN_XP_PER_KM = 10;

interface StubRun {
  id: string;
  user_id: string;
  date: string;
  distance: number;
  xp_gained: number;
  multiplier: number;
  streak_day: number;
  base_xp: number;
  km_xp: number;
  distance_bonus: number;
  streak_bonus: number;
  is_treadmill: boolean | null;
  source: string;
  start_time: null;
  created_at: string;
}

/**
 * Det som ändras under en körning: rundorna löparen loggat. Ett nytt tillstånd per webbläsarkontext (installStubApi), så ett test ser aldrig ett annat tests rundor
 * och inget behöver städas efteråt.
 */
interface StubState {
  runs: StubRun[];
}

/** Löparen som topplistan svarar med: grundtotalerna plus de rundor som loggats i den här körningen. */
function runnerOf(state: StubState) {
  return {
    ...STUB_USER,
    total_xp: BASE_XP + state.runs.reduce((sum, run) => sum + run.xp_gained, 0),
    current_level: 4,
    total_km: BASE_KM + state.runs.reduce((sum, run) => sum + run.distance, 0),
    current_streak: 3,
    longest_streak: 5,
    runs: state.runs,
  };
}

function runFrom(state: StubState, sent: CreateRunRequest): StubRun {
  const kmXp = Math.round(sent.distance * STUB_RUN_XP_PER_KM);
  return {
    id: `stub-run-${state.runs.length + 1}`,
    user_id: STUB_USER.id,
    date: sent.date,
    distance: sent.distance,
    xp_gained: STUB_RUN_BASE_XP + kmXp,
    multiplier: 1,
    streak_day: 1,
    base_xp: STUB_RUN_BASE_XP,
    km_xp: kmXp,
    distance_bonus: 0,
    streak_bonus: 0,
    is_treadmill: sent.is_treadmill ?? null,
    source: 'manual',
    start_time: null,
    created_at: new Date().toISOString(),
  };
}

// Slugarna kommer ur shared (en källa med frontendens kö, useOnboardingQueue): förstagångsturen och sidoturerna är fasta, "What's new"-slugarna
// (`patch_v<version>`) räknas ur changelog.json. En ny sidotur eller announce-post väcker alltså ingen popup i en stubbad körning.
function announcedPatchSlugs(): string[] {
  const file = new URL('../../frontend/src/data/changelog.json', import.meta.url);
  const { releases } = JSON.parse(readFileSync(file, 'utf8')) as { releases: Array<{ version: string; announce?: boolean }> };
  return releases.filter((release) => release.announce === true).map((release) => patchSlugForVersion(release.version));
}

/** Ett konto som sett allt: ingen tur och ingen "What's new"-popup över sidan. */
export function seenEverything(): OnboardingStatusResponse {
  return { seen: [...FIXED_ONBOARDING_SLUGS, ...announcedPatchSlugs()] };
}

const publicStats: PublicStatsApiResponse = { success: true, data: { runners: 6, challenges: 42, km: 1234 } };

// Podiekortets dekor ur svar som ger alla tre: en innehavd titel, en rank-pil som inte är platt och en badge-mini. Specerna kräver att inget kort någonsin ritas
// med motsvarande tomläge ("No titles held yet", —, ingen mini) när datan finns i svaren.
const userTitles: UserTitlesResponse = {
  success: true,
  data: [
    {
      title_id: 'stub-title-1',
      title_name: 'Stub Title',
      title_description: 'A title for the stubbed runner',
      position: 1,
      value: 1,
      earned_at: '2026-10-01T00:00:00.000Z',
      is_current_holder: true,
      status: 'holder',
    },
  ],
  meta: { user_id: STUB_USER.id, total_titles: 1, current_holder_count: 1, timestamp: '2026-10-19T00:00:00.000Z' },
};

const rankDelta: RankDeltaApiResponse = {
  success: true,
  data: { as_of: '2026-10-12', users: [{ user_id: STUB_USER.id, xp: BASE_XP, rank: 1, previous_xp: 1100, previous_rank: 2, rank_delta: 1 }] },
};

const groupBadges: BadgeGroupApiResponse = {
  success: true,
  data: { members: [{ user_id: STUB_USER.id, showcase: [{ series: 'milestoner', tier: 2 }] }], holders: {} },
  meta: { member_count: 1 },
};

const xpConfig = {
  success: true,
  data: {
    settings: { base_xp: 10, xp_per_km: 10, bonus_5km: 5, bonus_10km: 10, bonus_15km: 15, bonus_20km: 20, min_run_distance: 2 },
    streak_multipliers: [],
  },
  meta: { settings_source: 'defaults', multipliers_source: 'defaults' },
};

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify(body) });
}

async function answer(route: Route, state: StubState): Promise<void> {
  const request = route.request();
  const { pathname } = new URL(request.url());
  const path = pathname.replace(/^\/api/, '');
  const method = request.method();

  if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS_HEADERS });
  if (method === 'POST' && path === '/auth/login') {
    const sent = request.postDataJSON() as { name?: string; password?: string } | null;
    const account = userCredentials();
    if (sent?.name === account.login && sent?.password === account.password) {
      return json(route, 200, { success: true, token: STUB_TOKEN, user: STUB_USER });
    }
    // Backendens fel har bara `error` (ingen `success`).
    return json(route, 401, { error: 'Invalid credentials' });
  }
  if (method === 'GET' && path === '/public/stats') return json(route, 200, publicStats);
  if (method === 'GET' && path === '/auth/users-with-runs') return json(route, 200, { success: true, data: [runnerOf(state)] });
  if (method === 'GET' && path.startsWith('/titles/user/')) return json(route, 200, userTitles);
  if (method === 'GET' && path === '/leaderboard/rank-delta') return json(route, 200, rankDelta);
  if (method === 'GET' && path === '/badges/group') return json(route, 200, groupBadges);
  if (method === 'GET' && path === '/onboarding/status') return json(route, 200, seenEverything());
  if (method === 'POST' && path === '/onboarding/mark-seen') return json(route, 200, { ok: true });
  if (method === 'GET' && path === '/config/xp') return json(route, 200, xpConfig);
  if (method === 'POST' && path === '/waitlist') {
    // Samma svar för varje anmälan (WaitlistSignupResponse i shared, som är handskriven här av samma skäl som config/xp: kontraktsfilen drar in dataPolicy och kalendern, som inte klarar
    // e2e:s strängare flaggor), och inget sparas: ingen e-postadress lämnar webbläsaren.
    return json(route, 200, { success: true });
  }
  if (method === 'POST' && path === '/runs') {
    const sent = request.postDataJSON() as CreateRunRequest | null;
    if (!sent || !sent.date || !(sent.distance > 0)) return json(route, 400, { error: 'Date and distance are required' });
    const run = runFrom(state, sent);
    state.runs.push(run);
    return json(route, 200, { success: true, message: 'Run created successfully', run });
  }
  // Allt annat som appen frågar efter får 404 ("Not stubbed"): sviten bevisar laddningsvyn och övergången, inte datan. Sidor som behöver mer (nyheter, rundhistorik) hör hemma i sviten mot staging.
  return json(route, 404, { error: 'Not stubbed' });
}

/** Besvarar API-adressens förfrågningar i en webbläsarkontext med fejkade svar. Kastar om det inte är en lokal körning. */
export async function installStubApi(context: BrowserContext): Promise<void> {
  assertStubApiAllowed(targets, STUB_ENV_NAME);
  const state: StubState = { runs: [] };
  await context.route(`${targets.apiUrl}/**`, (route) => answer(route, state));
}
