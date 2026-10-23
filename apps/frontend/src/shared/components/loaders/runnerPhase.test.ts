import { describe, expect, it, vi } from 'vitest';
import { alignRunnersWithClock, RUNNER_PHASE_PENDING_CLASS, RUNNER_PHASE_SELECTOR, runnerPhaseScript } from './runnerPhase';

// Löparprickarna ska stå kvar där de var när laddaren byter nod eller dokument: fasen räknas från klockan, inte från när noden skapades. Webbläsarens animationsobjekt
// ersätts här av enkla objekt med de fält funktionen läser; själva rörelsen och bytena provas i webbläsare (apps/e2e/tests/loader-continuity.spec.ts).

interface FakeAnimation {
  animationName: string;
  startTime: number | null;
  effect: { getComputedTiming: () => { duration: number; iterations: number } };
}

const orbit = (lapMs: number, iterations = Number.POSITIVE_INFINITY): FakeAnimation => ({
  animationName: 'rqOrbit',
  startTime: null,
  effect: { getComputedTiming: () => ({ duration: lapMs, iterations }) },
});

/** En laddare med en prick per animation (rotens div-barn) och de animationer webbläsaren hittar där just nu. */
const loaderWith = (...animations: FakeAnimation[]) => ({ getAnimations: () => animations, querySelectorAll: () => animations.map(() => ({})) }) as unknown as Element;

/** Var i varvet en animation står vid dokumentets tid `timelineMs`, utan prickens egen fördröjning. */
const lapPosition = (animation: FakeAnimation, timelineMs: number, lapMs: number): number => (((timelineMs - (animation.startTime ?? 0)) % lapMs) + lapMs) % lapMs;

describe('aligning the runner dots with the clock', () => {
  it('puts a dot at the same place in its lap in two documents at the same instant, however long ago each document began', () => {
    const lapMs = 2_400;
    const instant = 1_760_000_050_000;
    const [oldDoc, newDoc] = [1_760_000_000_123.4, 1_760_000_049_876.5].map((timeOrigin) => {
      const animation = orbit(lapMs);
      alignRunnersWithClock(loaderWith(animation), timeOrigin);
      return lapPosition(animation, instant - timeOrigin, lapMs);
    });

    expect(newDoc).toBeCloseTo(oldDoc!, 6);
  });

  it('does it for every lane with its own lap time', () => {
    const lanes = [orbit(2_400), orbit(3_240), orbit(4_200)];
    alignRunnersWithClock(loaderWith(...lanes), 1_760_000_000_000);

    for (const lane of lanes) {
      const lapMs = lane.effect.getComputedTiming().duration;
      expect(lapPosition(lane, 5_000, lapMs)).toBeCloseTo(1_760_000_005_000 % lapMs, 6);
    }
  });

  it('leaves animations that are not the stadium orbit alone, and does not count them', () => {
    const other = { ...orbit(2_400), animationName: 'rqSpin' };

    expect(alignRunnersWithClock(loaderWith(other), 1_760_000_000_000)).toBe(0);
    expect(other.startTime).toBeNull();
  });

  it('leaves a dot alone that does not repeat, which is how reduced motion shows it, but counts it as seen', () => {
    const still = orbit(0.01, 1);

    expect(alignRunnersWithClock(loaderWith(still), 1_760_000_000_000)).toBe(1);
    expect(still.startTime).toBeNull();
  });

  it('does nothing where the browser has no Web Animations', () => {
    expect(alignRunnersWithClock({} as Element, 1_760_000_000_000)).toBe(0);
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY])('does not set a start time from a document clock of %s', (timeOrigin) => {
    const animation = orbit(2_400);

    expect(() => alignRunnersWithClock(loaderWith(animation), timeOrigin as unknown as number)).not.toThrow();
    expect(animation.startTime).toBeNull();
  });

  it('does not throw when the browser throws while listing the animations', () => {
    const broken = { getAnimations: () => { throw new Error('no animations here'); } } as unknown as Element;

    expect(alignRunnersWithClock(broken, 1_760_000_000_000)).toBe(0);
  });

  it('does not throw when the browser refuses the start time', () => {
    const refusing = orbit(2_400);
    Object.defineProperty(refusing, 'startTime', { set: () => { throw new TypeError('refused'); }, get: () => null });

    expect(() => alignRunnersWithClock(loaderWith(refusing), 1_760_000_000_000)).not.toThrow();
  });
});

describe('the inline script for the pre-rendered loader', () => {
  type Records = Array<{ addedNodes: unknown[] }>;

  /** Kör skriptet mot ett låtsasdokument med en låtsasobserver och ger tillbaka det den registrerade. */
  function runScript({ webAnimations = true, reducedMotion = false } = {}) {
    let notify: (records: Records) => void = () => undefined;
    const observer = { observe: vi.fn(), disconnect: vi.fn() };
    class FakeObserver {
      constructor(callback: (records: Records) => void) {
        notify = callback;
      }
      observe = observer.observe;
      disconnect = observer.disconnect;
    }
    const loaders: unknown[] = [];
    const listeners = new Map<string, { listener: () => void; capture: boolean }>();
    const classes = new Set<string>();
    const document = {
      documentElement: { classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) } },
      addEventListener: vi.fn((type: string, listener: () => void, capture: boolean) => listeners.set(type, { listener, capture })),
      removeEventListener: vi.fn(),
      querySelectorAll: (selector: string) => (selector === RUNNER_PHASE_SELECTOR ? loaders : []),
    };
    const element = { prototype: webAnimations ? { getAnimations: () => [] } : {} };
    const matchMedia = (query: string) => ({ matches: reducedMotion && query === '(prefers-reduced-motion: reduce)' });
    new Function('document', 'performance', 'MutationObserver', 'Element', 'matchMedia', runnerPhaseScript())(
      document,
      { timeOrigin: 1_760_000_000_000 },
      FakeObserver,
      element,
      matchMedia,
    );
    return { document, observer, listeners, loaders, classes, insert: (...nodes: unknown[]) => notify([{ addedNodes: nodes }]) };
  }

  const onTheClock = -(1_760_000_000_000 % 2_400);

  it('aligns a loader when its markup is parsed, using the document clock, with nothing from this module in scope', () => {
    const animation = orbit(2_400);
    const loader = loaderWith(animation);
    const dot = { closest: (selector: string) => (selector === RUNNER_PHASE_SELECTOR ? loader : null) };
    const { document, observer, insert } = runScript();

    expect(observer.observe).toHaveBeenCalledWith(document, { childList: true, subtree: true });
    insert(dot);

    expect(animation.startTime).toBeCloseTo(onTheClock, 6);
  });

  it('aligns the loaders again when a stylesheet has loaded, because the animations exist only once the style applies', () => {
    const animation = orbit(2_400);
    const { listeners, loaders } = runScript();
    loaders.push(loaderWith(animation));

    const load = listeners.get('load')!;
    // Fångstfasen: laddningshändelsen från en <link> bubblar inte.
    expect(load.capture).toBe(true);
    load.listener();

    expect(animation.startTime).toBeCloseTo(onTheClock, 6);
  });

  it('keeps the dots hidden until every dot of a loader is on the clock, so no frame shows one on its own zero', () => {
    const { classes, listeners, loaders, insert } = runScript();
    expect(classes.has(RUNNER_PHASE_PENDING_CLASS)).toBe(true);

    // Noden finns men stilmallen inte: inga animationer att sätta.
    const early = loaderWith();
    loaders.push(early);
    insert({ closest: () => early });
    expect(classes.has(RUNNER_PHASE_PENDING_CLASS)).toBe(true);

    // Stilmallen är laddad: alla tre prickarna har sin animation.
    loaders.length = 0;
    loaders.push(loaderWith(orbit(2_400), orbit(3_240), orbit(4_200)));
    listeners.get('load')!.listener();
    expect(classes.has(RUNNER_PHASE_PENDING_CLASS)).toBe(false);
  });

  it('lets the dots show when the document has been parsed even if nothing could be aligned', () => {
    const { classes, listeners } = runScript();

    listeners.get('DOMContentLoaded')!.listener();

    expect(classes.has(RUNNER_PHASE_PENDING_CLASS)).toBe(false);
  });

  it('stops observing and listening when the document has been parsed', () => {
    const { document, observer, listeners } = runScript();

    listeners.get('DOMContentLoaded')!.listener();

    expect(observer.disconnect).toHaveBeenCalled();
    expect(document.removeEventListener).toHaveBeenCalledWith('load', listeners.get('load')!.listener, true);
  });

  it('hides nothing and listens to nothing where the browser has no Web Animations', () => {
    const { classes, document } = runScript({ webAnimations: false });

    expect(classes.size).toBe(0);
    expect(document.addEventListener).not.toHaveBeenCalled();
  });

  it('hides nothing and listens to nothing with reduced motion: its animations have already ended, so there is no phase to wait for', () => {
    const { classes, document, observer } = runScript({ reducedMotion: true });

    expect(classes.size).toBe(0);
    expect(document.addEventListener).not.toHaveBeenCalled();
    expect(observer.observe).not.toHaveBeenCalled();
  });

  it('keeps the dots shown when only some of them still have an animation to align', () => {
    // Fler prickar än levande animationer (en som redan tagit slut räknas inte av getAnimations): skriptet väntar inte för evigt, DOMContentLoaded släpper dem.
    const { classes, listeners, loaders } = runScript();
    const loader = { getAnimations: () => [orbit(2_400)], querySelectorAll: () => [{}, {}, {}] } as unknown as Element;
    loaders.push(loader);

    listeners.get('load')!.listener();
    expect(classes.has(RUNNER_PHASE_PENDING_CLASS)).toBe(true);
    listeners.get('DOMContentLoaded')!.listener();

    expect(classes.has(RUNNER_PHASE_PENDING_CLASS)).toBe(false);
  });

  it('aligns a loader once per batch of inserted nodes, and not again when it is already on the clock', () => {
    const calls = vi.fn(() => [orbit(2_400), orbit(3_240), orbit(4_200)]);
    const loader = { getAnimations: calls, querySelectorAll: () => [{}, {}, {}] } as unknown as Element;
    const node = { closest: () => loader };
    const { listeners, loaders, insert } = runScript();
    loaders.push(loader);

    insert(node, node, node);
    expect(calls).toHaveBeenCalledTimes(1);
    insert(node);
    listeners.get('load')!.listener();

    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('aligns a dot that is parsed after its loader was aligned, when index.html arrives in several pieces', () => {
    // Första biten av dokumentet har laddaren med en prick: den rättas och sidan visas. Nästa bit ger prick två, som ska rättas lika.
    const first = orbit(2_400);
    const second = orbit(3_240);
    const dots: unknown[] = [{}];
    const animations = [first];
    const loader = { getAnimations: () => animations, querySelectorAll: () => dots } as unknown as Element;
    const node = { closest: () => loader };
    const { classes, loaders, insert } = runScript();
    loaders.push(loader);

    insert(node);
    expect(classes.has(RUNNER_PHASE_PENDING_CLASS)).toBe(false);
    expect(first.startTime).toBeCloseTo(onTheClock, 6);

    dots.push({});
    animations.push(second);
    insert(node);

    expect(second.startTime).toBeCloseTo(-(1_760_000_000_000 % 3_240), 6);
  });

  it('does not throw out of the observer or the load listener when the browser throws', () => {
    const loader = { getAnimations: () => { throw new Error('no animations here'); }, querySelectorAll: () => [] } as unknown as Element;
    const { listeners, loaders, insert } = runScript();
    loaders.push(loader);

    expect(() => insert({ closest: () => loader })).not.toThrow();
    expect(() => listeners.get('load')!.listener()).not.toThrow();
  });

  it('leaves nodes outside a loader alone, text included', () => {
    const { insert } = runScript();

    expect(() => insert({ closest: () => null }, { nodeType: 3 })).not.toThrow();
  });

  it('is plain script text that cannot close its own tag', () => {
    expect(runnerPhaseScript()).not.toMatch(/<\/script/i);
  });
});
