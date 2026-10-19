/**
 * Avslut av processen som hinner skicka köade Sentry-händelser först. server.ts går inte att importera i ett test,
 * så logiken ligger här med beroendena inskickade.
 */

export interface ExitDeps {
  /** Väntar tills köade händelser är skickade (flushSentry). Får gärna avvisa: processen avslutas ändå. */
  flush: () => Promise<unknown>;
  exit: (code: number) => void;
}

/** `process.exit` efter en flush, för start- och serverfel där loggraden annars försvinner med processen. */
export async function exitAfterFlush(code: number, deps: ExitDeps): Promise<void> {
  try {
    await deps.flush();
  } catch {
    // Ingen väg att rapportera ett fel i rapporteringen; avsluta ändå.
  }
  deps.exit(code);
}

export interface ShutdownDeps extends ExitDeps {
  closeServer: (onClosed: () => void) => void;
  log: (message: string) => void;
  /** Efter så här lång tid avslutas processen med kod 1 även om öppna anslutningar hindrar servern från att stänga. */
  forceExitAfterMs: number;
}

/** Ordnad nedstängning för SIGTERM (Railway vid deploy) och SIGINT: stäng servern, skicka köade händelser, avsluta med 0. */
export function createShutdown(deps: ShutdownDeps): (signal: string) => Promise<void> {
  let started = false;
  return async (signal: string) => {
    if (started) return;
    started = true;
    deps.log(`🔄 ${signal}: shutting down gracefully...`);

    const force = setTimeout(() => {
      deps.log('⚠️ Shutdown took too long, forcing exit');
      deps.exit(1);
    }, deps.forceExitAfterMs);
    force.unref();

    const closed = new Promise<void>((resolve) => deps.closeServer(resolve));
    await Promise.all([closed, deps.flush().catch(() => undefined)]);
    clearTimeout(force);
    deps.log('✅ Server closed');
    deps.exit(0);
  };
}
