// Loggbok över inloggningar mot en backend. Backendens gräns (20 per 15 minuter och IP, middleware/rateLimit.ts) delas av ALLA körningar
// från samma dator och av ägarens egna inloggningar, så ett enskilt skripts budget räcker inte: två körningar i rad skulle tillsammans
// låsa ut IP-adressen. Loggboken sparar hur många inloggningar varje körning reserverade, och en ny körning som inte får plats vägras.
// Den räknar bara värdens inloggningar den själv gjort; ägarens egna inloggningar syns inte, därför är taket 15 av 20.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MAX_LOGINS_PER_RUN } from './config.mjs';

export const LEDGER_WINDOW_MS = 15 * 60 * 1000;

export class LoginWindowBusy extends Error {
  constructor(message) {
    super(message);
    this.name = 'LoginWindowBusy';
  }
}

/** Antal inloggningar mot `baseUrl` de senaste 15 minuterna enligt loggboken. */
export function loginsInWindow(entries, baseUrl, nowMs) {
  return entries
    .filter((e) => e.baseUrl === baseUrl && nowMs - e.at < LEDGER_WINDOW_MS)
    .reduce((sum, e) => sum + e.count, 0);
}

/** Kastar LoginWindowBusy om `needed` inloggningar inte får plats under taket tillsammans med dem som redan gjorts i fönstret. */
export function assertLoginRoom(entries, baseUrl, needed, nowMs, { force = false } = {}) {
  if (force) return;
  const used = loginsInWindow(entries, baseUrl, nowMs);
  if (used + needed <= MAX_LOGINS_PER_RUN) return;
  const oldest = Math.min(...entries.filter((e) => e.baseUrl === baseUrl && nowMs - e.at < LEDGER_WINDOW_MS).map((e) => e.at));
  const waitMinutes = Math.max(1, Math.ceil((oldest + LEDGER_WINDOW_MS - nowMs) / 60_000));
  throw new LoginWindowBusy(
    `Loggboken visar ${used} inloggningar mot ${baseUrl} de senaste 15 minuterna och den här körningen behöver ${needed} (tak ${MAX_LOGINS_PER_RUN} av backendens 20). ` +
    `Vänta ungefär ${waitMinutes} minut(er), eller sätt LOADTEST_IGNORE_LOGIN_LEDGER=1 om backend har startats om sedan dess (räknaren är in-memory).`,
  );
}

/** Loggbok i en JSON-fil. Innehåller bara tidpunkt, antal och värd; aldrig konton eller lösenord. */
export function createFileLedger(path, now = Date.now) {
  function read() {
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed.entries)) throw new Error('entries saknas');
      return parsed.entries;
    } catch {
      throw new Error(`login-ledger.json går inte att läsa (${path}). Ta bort filen om du vet att backendens räknare är nollställd, och försök igen.`);
    }
  }

  function write(entries) {
    mkdirSync(dirname(path), { recursive: true });
    const fresh = entries.filter((e) => now() - e.at < LEDGER_WINDOW_MS);
    writeFileSync(path, `${JSON.stringify({ entries: fresh }, null, 2)}\n`);
  }

  return {
    entries: read,
    reserve(baseUrl, count) {
      const id = `${now()}-${Math.random().toString(16).slice(2, 10)}`;
      write([...read(), { id, at: now(), count, baseUrl }]);
      return id;
    },
    settle(id, actualCount) {
      write(read().map((e) => (e.id === id ? { ...e, count: actualCount } : e)));
    },
  };
}
