import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { deferredEntryScript, ENTRY_START_TIMEOUT_MS } from './deferredEntry';

// Boot-skriptet som landing.html laddar i stället för ingångsmodulen: det väntar på första ritning och lägger då in förladdningarna och ingångsmodulen. Det körs
// här som i webbläsaren, mot en riktig DOM (jsdom) men med egna tidtagare och en egen PerformanceObserver, så att tiden och ritningarna styrs av testet.

const ENTRY = '/assets/landing-AbC123.js';
const PRELOADS = ['/assets/router-X1.js', '/assets/react-query-Y2.js', '/assets/form-Z3.js'];

interface PaintEntry {
  name: string;
}

/** Stand-in för PerformanceObserver: spelar upp redan gjorda ritningar vid `observe` om `buffered` är satt, som webbläsaren, och tar emot nya med `paint()`. */
function createPaintTiming(options: { supported: boolean; recorded?: PaintEntry[] }) {
  const recorded = [...(options.recorded ?? [])];
  const callbacks: Array<(list: { getEntriesByName: (name: string) => PaintEntry[] }) => void> = [];
  const listOf = (entries: PaintEntry[]) => ({ getEntriesByName: (name: string) => entries.filter((entry) => entry.name === name) });
  class FakeObserver {
    constructor(callback: (list: ReturnType<typeof listOf>) => void) {
      callbacks.push(callback);
    }
    observe(init: { type: string; buffered?: boolean }) {
      if (!options.supported || init.type !== 'paint') throw new TypeError('unsupported entry type');
      if (init.buffered && recorded.length > 0) callbacks.forEach((callback) => callback(listOf(recorded)));
    }
    disconnect() {}
  }
  return {
    Observer: FakeObserver,
    paint(name: string) {
      const entry = { name };
      recorded.push(entry);
      callbacks.forEach((callback) => callback(listOf([entry])));
    },
  };
}

interface Timer {
  callback: () => void;
  delay: number;
}

function visit(options: { paintTiming?: boolean; recorded?: PaintEntry[]; entry?: string; preloads?: string[]; frames?: boolean } = {}) {
  const { paintTiming = true, recorded, entry = ENTRY, preloads = PRELOADS, frames = true } = options;
  document.head.innerHTML = '';
  const timing = createPaintTiming({ supported: paintTiming, recorded });
  const timers: Timer[] = [];
  const frameCallbacks: Array<() => void> = [];
  const sandbox: Record<string, unknown> = {
    document,
    PerformanceObserver: timing.Observer,
    setTimeout: (callback: () => void, delay = 0) => timers.push({ callback, delay }),
  };
  if (frames) sandbox.requestAnimationFrame = (callback: () => void) => frameCallbacks.push(callback);
  runInNewContext(deferredEntryScript({ entry, preloads }), sandbox);
  return {
    paint: timing.paint,
    /** Kör alla tidtagare som väntar (en timeout som löper ut) i den ordning de lades. */
    runTimers: () => timers.splice(0).forEach((timer) => timer.callback()),
    runFrames: () => frameCallbacks.splice(0).forEach((callback) => callback()),
    timers,
    modulePreloads: () => Array.from(document.head.querySelectorAll('link[rel="modulepreload"]')),
    moduleScripts: () => Array.from(document.head.querySelectorAll('script[type="module"]')),
  };
}

describe('the deferred entry script in landing.html', () => {
  it('adds nothing to the page until the first contentful paint has happened', () => {
    const page = visit();
    expect(page.modulePreloads()).toHaveLength(0);
    expect(page.moduleScripts()).toHaveLength(0);
  });

  it('preloads the entry graph and then loads the entry module once the first contentful paint is reported', () => {
    const page = visit();
    page.paint('first-contentful-paint');
    expect(page.modulePreloads().map((link) => link.getAttribute('href'))).toEqual(PRELOADS);
    expect(page.moduleScripts().map((script) => script.getAttribute('src'))).toEqual([ENTRY]);
    const loaded = Array.from(document.head.children);
    expect(loaded.indexOf(page.moduleScripts()[0])).toBeGreaterThan(loaded.indexOf(page.modulePreloads()[PRELOADS.length - 1]));
  });

  it('keeps the same-origin CORS mode that the build gave the static tags (crossorigin on the preloads and the module)', () => {
    const page = visit();
    page.paint('first-contentful-paint');
    for (const element of [...page.modulePreloads(), ...page.moduleScripts()]) expect(element.hasAttribute('crossorigin')).toBe(true);
  });

  it('does not start on a first-paint entry, only on first-contentful-paint', () => {
    const page = visit();
    page.paint('first-paint');
    expect(page.moduleScripts()).toHaveLength(0);
    page.paint('first-contentful-paint');
    expect(page.moduleScripts()).toHaveLength(1);
  });

  it('starts at once when the first contentful paint was recorded before the script ran', () => {
    const page = visit({ recorded: [{ name: 'first-paint' }, { name: 'first-contentful-paint' }] });
    expect(page.moduleScripts()).toHaveLength(1);
  });

  it('starts only once even when the paint and the timeout both arrive', () => {
    const page = visit();
    page.paint('first-contentful-paint');
    page.paint('first-contentful-paint');
    page.runTimers();
    expect(page.moduleScripts()).toHaveLength(1);
    expect(page.modulePreloads()).toHaveLength(PRELOADS.length);
  });

  it('starts anyway when no paint is ever reported (a tab opened in the background), after the timeout', () => {
    const page = visit();
    expect(page.timers.some((timer) => timer.delay === ENTRY_START_TIMEOUT_MS)).toBe(true);
    page.runTimers();
    expect(page.moduleScripts().map((script) => script.getAttribute('src'))).toEqual([ENTRY]);
  });

  it('where paint timing is unsupported, starts in the task after the next frame instead of never', () => {
    const page = visit({ paintTiming: false });
    expect(page.moduleScripts()).toHaveLength(0);
    page.runFrames();
    page.runTimers();
    expect(page.moduleScripts()).toHaveLength(1);
  });

  it('where neither paint timing nor frames exist, still starts when the timeout runs out', () => {
    const page = visit({ paintTiming: false, frames: false });
    page.runTimers();
    expect(page.moduleScripts()).toHaveLength(1);
  });

  it('passes addresses through untouched, also when they hold quotes, backslashes or markup', () => {
    const odd = ['/assets/a"b.js', "/assets/c'd.js", '/assets/e\\f.js', '/assets/</script>.js'];
    const page = visit({ entry: '/assets/x"y</script>.js', preloads: odd });
    page.paint('first-contentful-paint');
    expect(page.modulePreloads().map((link) => link.getAttribute('href'))).toEqual(odd);
    expect(page.moduleScripts().map((script) => script.getAttribute('src'))).toEqual(['/assets/x"y</script>.js']);
  });
});
