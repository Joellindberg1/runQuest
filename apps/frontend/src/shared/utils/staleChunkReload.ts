// Efter en deploy finns de gamla hashade kodfilerna inte kvar. En flik som laddades
// före deployen får då fel när den lazy-laddar en sida (Vite skickar `vite:preloadError`).
// En omladdning hämtar ny index.html med nya filnamn. Spärren hindrar en loop om felet
// beror på något annat än en deploy: inom fönstret får felet gå vidare till ErrorBoundary.

const STORAGE_KEY = 'rq_stale_chunk_reload_at';
export const RELOAD_GUARD_MS = 30_000;

type GuardStorage = Pick<Storage, 'getItem' | 'setItem'>;

// Meddelandena webbläsarna och Vite ger när en kodfil från en äldre deploy saknas (Chrome, Firefox, Safari, Vite CSS-preload, webpack-stil).
const STALE_CHUNK_MESSAGE = /dynamically imported module|importing a module script failed|unable to preload css|loading (css )?chunk [\w-]+ failed/i;

/** Är felet en saknad kodfil efter en deploy? Då löser en omladdning det och det finns inget att felsöka: felspårningen rapporterar det inte. */
export function isStaleChunkError(error: unknown): boolean {
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  return STALE_CHUNK_MESSAGE.test(message);
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
    if (!claimStaleChunkReload(now(), getStorage())) return;
    event.preventDefault();
    target.location.reload();
  });
}
