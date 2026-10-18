// De fyra scenarierna: inloggning, topplista, logga runda, news. Varje scenario gör ett enda anrop mot en av klientens tillåtna rutter.
// Inget scenario når Strava: klienten nekar varje rutt som inte står på tillåtelselistan (client.mjs), och de fyra backendrutterna
// (auth, leaderboard, news, runs) importerar ingen Strava-kod.
import { randomBytes } from 'node:crypto';

/** Första åtta hextecknen i varje Idempotency-Key som lasttestet skickar ("10ad7e57" ~ "loadtest"). Märker rundorna i databasen. */
export const RUN_KEY_PREFIX = '10ad7e57';
/** Rundornas distans: fast och ovanligt lik ingen riktig runda, ett andra märke utöver nyckeln. Backendens minimum är 1,0 km. */
export const RUN_DISTANCE_KM = 1.01;

/** En uuid v4 (backend kräver v4) vars första grupp är RUN_KEY_PREFIX. */
export function newRunKey(bytes = randomBytes) {
  const hex = bytes(10).toString('hex');
  const variant = '89ab'[parseInt(hex[0], 16) % 4];
  return `${RUN_KEY_PREFIX}-${hex.slice(1, 5)}-4${hex.slice(5, 8)}-${variant}${hex.slice(8, 11)}-${bytes(6).toString('hex')}`;
}

/** Dagens datum som YYYY-MM-DD i Stockholm, samma kalenderdag som backend jämför mot ("Cannot log runs for future dates"). */
export function todayStockholm(clock = () => new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(clock());
}

/** Ett rundanrop utan id i svaret kan ändå ha skrivit en runda bara om servern kan ha hunnit skriva: nätverksfel/timeout, 5xx eller ett 2xx utan id. */
export function mayHaveWritten(result) {
  return result.status === null || result.status >= 500 || result.outcome === 'ok';
}

export async function loginUser(client, user) {
  const result = await client.request({ scenario: 'login', method: 'POST', path: '/api/auth/login', body: { name: user.login, password: user.password } });
  if (result.outcome === 'ok' && typeof result.json?.token === 'string') user.token = result.json.token;
  return result;
}

/**
 * Scenarietabellen. `available(state, user)` avgör om scenariot kan väljas just nu; `run(context)` gör anropet.
 * Budgetarna dras ner INNAN anropet så att samtidiga användare aldrig tillsammans överskrider dem.
 */
export function createScenarios({ client, newKey, today }) {
  return {
    leaderboard: {
      available: () => true,
      run: async ({ user }) => {
        await client.request({ scenario: 'leaderboard', method: 'GET', path: '/api/leaderboard/week', token: user.token });
      },
    },

    news: {
      available: () => true,
      run: async ({ user }) => {
        await client.request({ scenario: 'news', method: 'GET', path: '/api/news?limit=20', token: user.token });
      },
    },

    'log-run': {
      // En runda i taget per användare: samma användare som loggar två rundor samtidigt är inte ett verkligt mönster och ger bara omräkningskrockar.
      available: (state, user) => state.runsLeft > 0 && !state.busy.has(user.login),
      run: async ({ user, state }) => {
        state.runsLeft--;
        state.busy.add(user.login);
        const key = newKey();
        try {
          const result = await client.request({
            scenario: 'log-run',
            method: 'POST',
            path: '/api/runs',
            token: user.token,
            headers: { 'Idempotency-Key': key },
            body: { date: today(), distance: RUN_DISTANCE_KM },
          });
          const id = result.json?.run?.id;
          if (result.outcome === 'ok' && typeof id === 'string') state.createdRuns.push({ id, userIndex: user.index, key });
          // Ett 500 med written: true kan ha lämnat en runda utan id i svaret; ett 400/401/429 har inte skapat något och listas inte.
          else if (mayHaveWritten(result)) state.unresolvedKeys.push(key);
        } finally {
          state.busy.delete(user.login);
        }
      },
    },

    login: {
      available: (state) => state.loginsLeft > 0,
      run: async ({ user, state }) => {
        state.loginsLeft--;
        const result = await loginUser(client, user);
        // Ett 429 betyder att gränsen nåtts: sluta logga in för resten av körningen i stället för att hamra på den.
        if (result.outcome === 'rate_limited') state.loginsLeft = 0;
      },
    },
  };
}
