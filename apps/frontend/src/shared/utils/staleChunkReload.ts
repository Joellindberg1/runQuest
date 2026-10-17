// Efter en deploy finns de gamla hashade kodfilerna inte kvar. En flik som laddades
// före deployen får då fel när den lazy-laddar en sida (Vite skickar `vite:preloadError`).
// En omladdning hämtar ny index.html med nya filnamn. Spärren hindrar en loop om felet
// beror på något annat än en deploy: inom fönstret får felet gå vidare till ErrorBoundary.

const STORAGE_KEY = 'rq_stale_chunk_reload_at';
export const RELOAD_GUARD_MS = 30_000;

type GuardStorage = Pick<Storage, 'getItem' | 'setItem'>;

// Meddelandena webbläsarna och Vite ger när en kodfil från en äldre deploy saknas (Chrome, Firefox, Safari, Vite CSS-preload, webpack-stil).
const STALE_CHUNK_MESSAGE = /dynamically imported module|importing a module script failed|unable to preload css|loading (css )?chunk [\w-]+ failed/i;

export function errorMessage(error: unknown): string {
  return typeof error === 'string' ? error : error instanceof Error ? error.message : '';
}

/** Är felet en saknad kodfil efter en deploy? Då löser en omladdning det och det finns inget att felsöka: felspårningen rapporterar det inte. */
export function isStaleChunkError(error: unknown): boolean {
  return STALE_CHUNK_MESSAGE.test(errorMessage(error));
}

// Valfria chunkar (felspårningen) kan saknas av andra skäl än en deploy, t.ex. en annonsblockerare, och en omladdning hjälper inte då.
// vite.config.ts ger dem filnamn som börjar med `optional-` (och inget som en blockerare känner igen). Safari nämner ingen adress i felet;
// där räcker det att en valfri import pågår och att felet inte pekar på någon annan fil.
const OPTIONAL_CHUNK_URL = /\/assets\/optional-[\w-]+\.js/;
const ANY_ASSET_ADDRESS = /https?:\/\/|\/assets\//;
let optionalImportsInFlight = 0;

/** Laddar en valfri chunk. Misslyckas den släpps felet vidare till anroparen och sidan laddas inte om. */
export async function loadOptionalChunk<T>(load: () => Promise<T>): Promise<T> {
  optionalImportsInFlight += 1;
  try {
    return await load();
  } finally {
    optionalImportsInFlight -= 1;
  }
}

function isOptionalChunkFailure(payload: unknown): boolean {
  const message = errorMessage(payload);
  if (OPTIONAL_CHUNK_URL.test(message)) return true;
  return optionalImportsInFlight > 0 && !ANY_ASSET_ADDRESS.test(message);
}

// Utan fungerande lagring går spärren inte att hålla över en omladdning, så då laddas
// inget om alls (annars oändlig loop vid ett bestående fel) och ErrorBoundary tar felet.
export function claimStaleChunkReload(now: number, storage: GuardStorage | null): boolean {
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(STORAGE_KEY) ?? 0);
    if (now - last < RELOAD_GUARD_MS) return false;
    storage.setItem(STORAGE_KEY, String(now));
    return storage.getItem(STORAGE_KEY) === String(now);
  } catch {
    return false;
  }
}

interface ReloadTarget {
  addEventListener(type: 'vite:preloadError', listener: (event: Event) => void): void;
  location: { reload(): void };
}

export function installStaleChunkReload(
  target: ReloadTarget,
  getStorage: () => GuardStorage | null,
  now: () => number = Date.now,
): void {
  target.addEventListener('vite:preloadError', (event) => {
    if (isOptionalChunkFailure((event as Event & { payload?: unknown }).payload)) return;
    if (!claimStaleChunkReload(now(), getStorage())) return;
    event.preventDefault();
    target.location.reload();
  });
}
