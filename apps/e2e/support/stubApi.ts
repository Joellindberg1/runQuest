import type { BrowserContext, Route } from '@playwright/test';
import { targets, userCredentials } from './targets';

/**
 * Fejkat API för körningar mot en lokal frontend (valfritt, av som standard). Mot staging används alltid det riktiga API:et.
 *
 * `E2E_STUB_API=1` slår på det, och bara när både frontenden och API:et är localhost (E2E-vakten): då besvaras alla förfrågningar till API-adressen i webbläsaren
 * med de svar nedan, och inget lämnar maskinen. Det gör att specerna för landningen och laddningsvyn (`tests/landing.spec.ts`) kan bevisas mot ett lokalt bygge
 * (`apps/frontend/dist` serverat av repo-rotens Caddyfile) utan staging, konto eller backend. Kontot är det som står i E2E_USER_LOGIN/E2E_USER_PASSWORD;
 * allt annat lösenord ger 401. Svarsformerna är de ur `apps/backend/src/routes`, bara så mycket som Board och landningen läser.
 */
export const STUB_ENV_NAME = 'E2E_STUB_API';

export function stubApiRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[STUB_ENV_NAME] === '1';
}

const STUB_USER = { id: 'stub-user-1', name: 'Stub Runner', email: 'stub-runner@example.test' };
// Ingen JWT-form: ett påhittat värde som inte kan förväxlas med en riktig token.
const STUB_TOKEN = 'stub-session-not-a-real-token';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

const stubRunner = {
  ...STUB_USER,
  total_xp: 1200,
  current_level: 4,
  total_km: 42.5,
  current_streak: 3,
  longest_streak: 5,
  is_admin: false,
  runs: [],
};

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify(body) });
}

async function answer(route: Route): Promise<void> {
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
    return json(route, 401, { success: false, error: 'Invalid credentials' });
  }
  if (method === 'GET' && path === '/public/stats') return json(route, 200, { success: true, data: { runners: 6, challenges: 42, km: 1234 } });
  if (method === 'GET' && path === '/auth/users-with-runs') return json(route, 200, { success: true, data: [stubRunner] });
  if (method === 'GET' && path === '/onboarding/status') return json(route, 200, { success: true, data: { tourSeen: true, welcomeSeen: true } });
  if (method === 'GET' && path === '/config/xp') {
    const settings = { base_xp: 10, xp_per_km: 10, bonus_5km: 5, bonus_10km: 10, bonus_15km: 15, bonus_20km: 20, min_run_distance: 2 };
    return json(route, 200, { success: true, data: { settings, streak_multipliers: [] }, meta: { settings_source: 'defaults', multipliers_source: 'defaults' } });
  }
  // Allt annat som appen frågar efter får 404 ("Not stubbed"): sviten bevisar laddningsvyn och övergången, inte datan. Sidor som behöver mer (logga runda, nyheter) hör hemma i sviten mot staging.
  return json(route, 404, { success: false, error: 'Not stubbed' });
}

/** Besvarar API-adressens förfrågningar i en webbläsarkontext med fejkade svar. Kastar om det inte är en lokal körning. */
export async function installStubApi(context: BrowserContext): Promise<void> {
  if (!targets.isLocal) throw new Error(`${STUB_ENV_NAME}=1 is only allowed when both E2E_BASE_URL and E2E_API_URL are localhost.`);
  await context.route(`${targets.apiUrl}/**`, answer);
}
