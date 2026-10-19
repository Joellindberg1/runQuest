import { readFileSync } from 'node:fs';
import { AUTH_FILE } from './paths';
import { targets } from './targets';

// Sidoanrop mot stagingbackenden för det UI:t inte ska bevisa: läsa testkontots totaler och städa efter sig. Adressen är redan kontrollerad av vakten.

/** Distansen som markerar testrundor. Ett jämnt, ovanligt litet tal på ett dedikerat konto: städningen tar bort manuella rundor med exakt den distansen. */
export const E2E_RUN_KM = 1.5;

export interface Session {
  token: string;
  userId: string;
  /** Namnet som Board visar för kontot. */
  userName: string;
}

interface StorageState {
  origins: Array<{ localStorage: Array<{ name: string; value: string }> }>;
}

/** Inloggningen som setup-projektet sparade (JWT och användare ur appens localStorage). Läses vid behov, inte när specerna samlas in. */
export function readSession(): Session {
  const state = JSON.parse(readFileSync(AUTH_FILE, 'utf8')) as StorageState;
  const stored = state.origins.flatMap((origin) => origin.localStorage);
  const token = stored.find((item) => item.name === 'runquest_token')?.value;
  const userJson = stored.find((item) => item.name === 'runquest_user')?.value;
  const user = userJson ? (JSON.parse(userJson) as { id?: string; name?: string }) : undefined;
  if (!token || !user?.id || !user.name) throw new Error('The saved sign-in has no session. Run the setup project first.');
  return { token, userId: user.id, userName: user.name };
}

async function call(session: Session, method: string, path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${targets.apiUrl}/api${path}`, { method, headers: { Authorization: `Bearer ${session.token}` } });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

interface RunRow {
  id: string;
  distance: number | string;
  source?: string;
}

interface RunnerRow {
  id: string;
  name: string;
  total_xp: number | string | null;
  total_km: number | string | null;
  runs?: RunRow[];
}

/** Gruppens löpare med sina rundor, i samma ordning som Board hämtar dem (GET /auth/users-with-runs). */
export async function fetchRunners(session: Session): Promise<RunnerRow[]> {
  const { status, body } = await call(session, 'GET', '/auth/users-with-runs');
  const data = (body as { data?: RunnerRow[] } | null)?.data;
  if (status !== 200 || !Array.isArray(data)) throw new Error(`Could not read the group (status ${status}).`);
  return data;
}

export interface Totals {
  xp: number;
  km: number;
}

export async function ownTotals(session: Session): Promise<Totals> {
  const me = (await fetchRunners(session)).find((runner) => runner.id === session.userId);
  if (!me) throw new Error('The test account is not in a group, so it has no standing.');
  return { xp: Number(me.total_xp ?? 0), km: Number(me.total_km ?? 0) };
}

/** Räknar om kontots totaler från dess rundor, så att en jämförelse före/efter inte fångar en gammal avvikelse i seeddatan. */
export async function recalculateOwnTotals(session: Session): Promise<void> {
  const { status } = await call(session, 'POST', '/auth/recalculate-totals');
  if (status !== 200) throw new Error(`Could not recalculate the totals (status ${status}).`);
}

/** Testkontots manuella rundor med markördistansen. */
export async function ownTestRuns(session: Session): Promise<RunRow[]> {
  const me = (await fetchRunners(session)).find((runner) => runner.id === session.userId);
  return (me?.runs ?? []).filter((run) => run.source !== 'strava' && Number(run.distance) === E2E_RUN_KM);
}

export async function deleteRun(session: Session, runId: string): Promise<void> {
  const { status, body } = await call(session, 'DELETE', `/runs/${encodeURIComponent(runId)}`);
  if (status !== 200) throw new Error(`Could not delete a test run (status ${status}): ${JSON.stringify(body)}`);
}

/** Tar bort alla testrundor. Idempotent: inga kvar är inget fel. Returnerar hur många som togs bort. */
export async function removeTestRuns(session: Session): Promise<number> {
  const runs = await ownTestRuns(session);
  for (const run of runs) await deleteRun(session, run.id);
  return runs.length;
}
