// Konfiguration ur miljövariabler. Inloggningsuppgifter läses ENBART här ur LOADTEST_USERS (en JSON-lista); inget hårdkodas och inget
// felmeddelande citerar värdet (JSON.parse-felets text kan innehålla ett utdrag av indata, så den används aldrig).
import { STAGING_BACKEND_URL, resolveBaseUrl } from './guard.mjs';
import { TARGETS } from './targets.mjs';

/**
 * Backendens inloggningsgräns är 20 försök per 15 minuter och IP (middleware/rateLimit.ts), och den räknar ALLA försök, även lyckade.
 * En körning får därför högst 15 inloggningar sammanlagt (en per användare i förberedelsen plus budgeten under körningen),
 * så att det alltid finns marginal kvar för ägarens egna inloggningar från samma IP.
 */
export const MAX_LOGINS_PER_RUN = 15;

function integerFrom(env, name, fallback, { min, max }) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} måste vara ett heltal mellan ${min} och ${max}`);
  }
  return value;
}

function parseUsers(raw) {
  const invalid = () => new Error('LOADTEST_USERS måste vara en JSON-lista med minst en post på formen {"login": "...", "password": "..."}');
  if (typeof raw !== 'string' || raw.trim() === '') throw invalid();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw invalid();
  }
  if (!Array.isArray(parsed) || parsed.length === 0) throw invalid();
  return parsed.map((entry) => {
    const login = entry?.login;
    const password = entry?.password;
    if (typeof login !== 'string' || login === '' || typeof password !== 'string' || password === '') throw invalid();
    return { login, password };
  });
}

/** Läser och prövar hela konfigurationen. Bas-URL:en prövas först, så en prod-adress stoppas innan något annat läses. */
export function loadConfig(env) {
  const baseUrl = resolveBaseUrl(env.LOADTEST_BASE_URL ?? STAGING_BACKEND_URL);
  const users = parseUsers(env.LOADTEST_USERS);
  if (users.length > MAX_LOGINS_PER_RUN) {
    throw new Error(`LOADTEST_USERS får ha högst ${MAX_LOGINS_PER_RUN} användare (inloggningsgränsen i backend är 20 per 15 minuter och IP)`);
  }
  const loginBudget = integerFrom(env, 'LOADTEST_LOGIN_BUDGET', Math.min(10, MAX_LOGINS_PER_RUN - users.length), { min: 0, max: MAX_LOGINS_PER_RUN - users.length });
  return {
    baseUrl,
    users,
    vus: integerFrom(env, 'LOADTEST_VUS', TARGETS.concurrentUsers, { min: 1, max: 50 }),
    durationSeconds: integerFrom(env, 'LOADTEST_DURATION_S', TARGETS.durationSeconds, { min: 5, max: 1800 }),
    thinkMs: integerFrom(env, 'LOADTEST_THINK_MS', 800, { min: 0, max: 30_000 }),
    timeoutMs: integerFrom(env, 'LOADTEST_TIMEOUT_MS', 15_000, { min: 1000, max: 120_000 }),
    loginBudget,
    runBudget: integerFrom(env, 'LOADTEST_RUN_BUDGET', 30, { min: 0, max: 200 }),
    keepRuns: env.LOADTEST_KEEP_RUNS === '1',
    outDir: env.LOADTEST_OUT_DIR || undefined,
  };
}
