// En fejkserver på 127.0.0.1 som svarar på samma rutter som lasttestet använder. Den finns för att lasttestets egen logik (budgetar,
// märkning, städning, rutt-vakten) ska kunna prövas utan nätverk mot något riktigt, och för `npm run loadtest:local`.
// Den härmar de beteenden som lasttestet beror på, inte backendens affärsregler:
//  - POST /api/auth/login har samma gräns som backend: 20 försök per 15 minuter och IP, och ALLA försök räknas.
//  - POST /api/runs är idempotent på Idempotency-Key och kräver distance >= 1 och ett datum som inte ligger i framtiden.
//  - DELETE /api/runs/:id svarar 409 för en runda som markerats `locked` (härmar en runda som kvalificerat ett event).
//  - Allt under /api/strava loggas som `stravaHits` och svarar 404; ett lasttest får aldrig ge en träff där.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function today() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date());
}

/**
 * @param {{ users?: Array<{login: string, password: string}>, loginLimit?: number, latencyMs?: number, failRuns?: boolean, lockAllRuns?: boolean }} options
 */
export async function startFakeServer({ users = [], loginLimit = 20, latencyMs = 0, failRuns = false, lockAllRuns = false } = {}) {
  const accounts = new Map(users.map((u, index) => [u.login, { id: `user-${index + 1}`, password: u.password }]));
  const state = {
    requests: [],
    stravaHits: 0,
    loginAttempts: 0,
    loginRejectedByLimit: 0,
    runs: new Map(),
    runsByKey: new Map(),
    runPosts: 0,
  };
  let loginWindowStart = Date.now();

  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const readBody = (req) => new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve({}); }
    });
  });

  const userFor = (req) => {
    const match = /^Bearer token-(user-\d+)$/.exec(req.headers.authorization ?? '');
    return match ? match[1] : null;
  };

  async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    state.requests.push({ method: req.method, path: url.pathname });
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));

    if (url.pathname.startsWith('/api/strava')) {
      state.stravaHits++;
      return send(res, 404, { error: 'Route not found' });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      if (Date.now() - loginWindowStart > LOGIN_WINDOW_MS) { loginWindowStart = Date.now(); state.loginAttempts = 0; }
      state.loginAttempts++;
      if (state.loginAttempts > loginLimit) {
        state.loginRejectedByLimit++;
        return send(res, 429, { error: 'Too many attempts, try again later' });
      }
      const body = await readBody(req);
      const account = accounts.get(body.name ?? body.email);
      if (!account || account.password !== body.password) return send(res, 401, { error: 'Invalid credentials' });
      return send(res, 200, { success: true, token: `token-${account.id}`, user: { id: account.id, name: body.name } });
    }

    const userId = userFor(req);
    if (!userId) return send(res, 401, { error: 'Access token required' });

    if (req.method === 'GET' && url.pathname === '/api/leaderboard/week') {
      return send(res, 200, { success: true, data: { entries: [] } });
    }
    if (req.method === 'GET' && url.pathname === '/api/news') {
      return send(res, 200, { success: true, data: [], meta: { unread_count: 0 } });
    }

    if (req.method === 'POST' && url.pathname === '/api/runs') {
      state.runPosts++;
      const key = req.headers['idempotency-key'];
      const body = await readBody(req);
      if (typeof key !== 'string' || !UUID_V4.test(key)) return send(res, 400, { error: 'Idempotency-Key must be a UUID v4' });
      if (failRuns) return send(res, 500, { error: 'Run was created but XP recalculation failed', written: true });
      if (!(Number(body.distance) >= 1)) return send(res, 400, { error: 'Distance must be at least 1.0 km' });
      if (typeof body.date !== 'string' || body.date > today()) return send(res, 400, { error: 'Cannot log runs for future dates' });
      const existing = state.runsByKey.get(`${userId}:${key}`);
      if (existing) return send(res, 200, { success: true, run: existing });
      const run = { id: randomUUID(), user_id: userId, date: body.date, distance: Number(body.distance), source: 'manual', client_request_id: key, locked: lockAllRuns };
      state.runs.set(run.id, run);
      state.runsByKey.set(`${userId}:${key}`, run);
      return send(res, 200, { success: true, run: { id: run.id, user_id: userId, date: run.date, distance: run.distance, source: 'manual' } });
    }

    const del = /^\/api\/runs\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (req.method === 'DELETE' && del) {
      const run = state.runs.get(del[1]);
      if (!run) return send(res, 404, { error: 'Run not found' });
      if (run.user_id !== userId) return send(res, 403, { error: 'Not authorized to delete this run' });
      if (run.locked) return send(res, 409, { error: "This run qualified an event and can't be deleted — edit it instead" });
      state.runs.delete(run.id);
      state.runsByKey.delete(`${userId}:${run.client_request_id}`);
      return send(res, 200, { success: true });
    }

    return send(res, 404, { error: 'Route not found' });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(() => send(res, 500, { error: 'Internal server error' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    state,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}
