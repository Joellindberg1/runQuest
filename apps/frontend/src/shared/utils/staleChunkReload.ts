// Efter en deploy finns de gamla hashade kodfilerna inte kvar. En flik som laddades
// före deployen får då fel när den lazy-laddar en sida (Vite skickar `vite:preloadError`).
// En omladdning hämtar ny index.html med nya filnamn. Spärren hindrar en loop om felet
// beror på något annat än en deploy: inom fönstret får felet gå vidare till ErrorBoundary.

const STORAGE_KEY = 'rq_stale_chunk_reload_at';
export const RELOAD_GUARD_MS = 30_000;

type GuardStorage = Pick<Storage, 'getItem' | 'setItem'>;

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
