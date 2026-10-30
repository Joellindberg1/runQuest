import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useTabRowFade } from './useTabRowFade';

// Kantfaden mäts ur radens scrollmått. Typsnittet kan komma efter första mätningen (reservtypsnittet är bredare, så innehållet krymper när det riktiga laddat) utan att radens
// egen box ändras: då triggas varken scroll eller en observer på raden. Raden mäts därför om när typsnitten laddat, och när en flik byter storlek. jsdom har ingen layout och
// inget `document.fonts`, så måtten och typsnittsobjektet lånas ut.

const layout = { client: 282, scroll: 430, reads: 0 };

class RecordingResizeObserver {
  static instances: RecordingResizeObserver[] = [];
  readonly targets = new Set<Element>();
  readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
    RecordingResizeObserver.instances.push(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
    RecordingResizeObserver.instances = RecordingResizeObserver.instances.filter((observer) => observer !== this);
  }
}

interface FakeFonts {
  ready: Promise<unknown>;
  listeners: Map<string, Set<() => void>>;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

function installFonts(ready: Promise<unknown>): FakeFonts {
  const listeners = new Map<string, Set<() => void>>();
  const fonts: FakeFonts = {
    ready,
    listeners,
    addEventListener: (type, listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener);
    },
  };
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
  return fonts;
}

const KEYS = ['a', 'b', 'c', 'd'];

function Row({ selected = 'a', count = 3 }: { selected?: string; count?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const fade = useTabRowFade(ref, selected, count);
  return (
    <div ref={ref} data-testid="wrap" data-fade-start={String(fade.start)} data-fade-end={String(fade.end)}>
      <div role="tablist" aria-label="Row">
        {KEYS.slice(0, count).map((key) => (
          <button key={key} role="tab" type="button" aria-selected={key === selected}>
            {key}
          </button>
        ))}
      </div>
    </div>
  );
}

function renderRow() {
  const view = render(<Row />);
  return { ...view, tablist: screen.getByRole('tablist'), wrap: screen.getByTestId('wrap') };
}

/** Som Board: gruppens storlek avgör om en fjärde flik (Position) finns. */
function Host() {
  const [members, setMembers] = useState(1);
  return (
    <>
      <Row count={members >= 2 ? 4 : 3} />
      <button type="button" onClick={() => setMembers(2)}>
        a second member joins
      </button>
    </>
  );
}

const endFade = () => screen.getByTestId('wrap').getAttribute('data-fade-end');

beforeEach(() => {
  layout.client = 282;
  layout.scroll = 430;
  RecordingResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', RecordingResizeObserver);
  const isRow = (element: Element) => element.getAttribute('role') === 'tablist';
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get(this: HTMLElement) { if (isRow(this)) layout.reads += 1; return isRow(this) ? layout.client : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get(this: HTMLElement) { return isRow(this) ? layout.scroll : 0; } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'fonts');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth');
});

describe('useTabRowFade: measuring again', () => {
  it('measures again when the fonts have loaded, because the content shrinks without the row changing size', async () => {
    let fontsLoaded: () => void = () => {};
    installFonts(new Promise((resolve) => { fontsLoaded = () => resolve(undefined); }));
    const { tablist } = renderRow();
    // Före typsnittet: det breda reservtypsnittet ger mer än raden rymmer, och faden syns.
    act(() => { tablist.dispatchEvent(new Event('scroll')); });
    expect(endFade()).toBe('true');

    // Typsnittet laddar: innehållet rymms, men ingen scroll och ingen ändring av radens box har skett.
    layout.scroll = 282;
    await act(async () => {
      fontsLoaded();
      await Promise.resolve();
    });

    expect(endFade()).toBe('false');
  });

  it('measures again on each loadingdone of the font set, for a face that finishes after the first ones', () => {
    const fonts = installFonts(Promise.resolve());
    renderRow();
    expect(endFade()).toBe('true');

    layout.scroll = 282;
    act(() => { fonts.listeners.get('loadingdone')?.forEach((listener) => listener()); });

    expect(endFade()).toBe('false');
  });

  it('measures again when a tab changes size, which a row of unchanged size does not report', () => {
    installFonts(Promise.resolve());
    const { tablist } = renderRow();
    const observer = RecordingResizeObserver.instances.find((candidate) => candidate.targets.has(tablist));
    expect(observer, 'the row is observed').toBeDefined();
    for (const tab of screen.getAllByRole('tab')) expect(observer!.targets.has(tab), `the "${tab.textContent}" tab is observed`).toBe(true);
    expect(endFade()).toBe('true');

    layout.scroll = 282;
    act(() => observer!.callback());

    expect(endFade()).toBe('false');
  });

  it('measures again when a tab is added, which neither a scroll nor a row of unchanged size reports', async () => {
    installFonts(Promise.resolve());
    layout.scroll = 282;
    render(<Host />);
    // Låt den redan lösta typsnittslöftet göra sin omräkning först, så att den inte är det som fångar fliken.
    await act(async () => {});
    expect(endFade()).toBe('false');

    // Den fjärde fliken kommer in och raden rymmer den inte: mått lånas ut utan någon scroll-händelse.
    layout.scroll = 430;
    await act(async () => {
      screen.getByRole('button', { name: 'a second member joins' }).click();
    });

    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(endFade()).toBe('true');
  });

  it('stops listening for fonts when the row goes away, and ignores a font promise that settles after it', async () => {
    let fontsLoaded: () => void = () => {};
    const fonts = installFonts(new Promise((resolve) => { fontsLoaded = () => resolve(undefined); }));
    const { unmount } = renderRow();
    expect(fonts.listeners.get('loadingdone')?.size).toBe(1);

    unmount();
    expect(fonts.listeners.get('loadingdone')?.size).toBe(0);
    expect(RecordingResizeObserver.instances).toHaveLength(0);
    // Löftet löser sig först nu: ingen mätning (inga läsningar av radens mått) får ske på en rad som inte finns kvar.
    const readsBefore = layout.reads;
    await act(async () => {
      fontsLoaded();
      await Promise.resolve();
    });
    expect(layout.reads).toBe(readsBefore);
  });

  it('works where the browser has no font set to wait for', () => {
    renderRow();

    expect(endFade()).toBe('true');
  });
});

// Efter ett flikbyte för ViewTabs den valda fliken i bild med `scrollLeft += delta`. `scrollLeft` är ett heltal, så en rest under en pixel kan bli kvar utanför kanten (flikens kant ligger några hundradels pixel förbi radens).
// En sådan rest är inget skäl att låta fliken ligga kvar i fadens zon: fadefriheten ska läggas på ändå.
describe('useTabRowFade: a selected tab that sits within a sub-pixel of the row edge', () => {
  const ZONE_PX = 24;
  const ROW = { left: 0, right: 282 };
  const SELECTED_WIDTH = 80;
  const tabBox = (left: number) => ({ left, right: left + SELECTED_WIDTH, width: SELECTED_WIDTH, top: 0, bottom: 44, height: 44, x: left, y: 0, toJSON: () => ({}) });
  const state = { scrollLeft: 0, tabLeft: 0 };
  const writes: number[] = [];

  beforeEach(() => {
    state.scrollLeft = 0;
    writes.length = 0;
    installFonts(Promise.resolve());
    const isRow = (element: Element) => element.getAttribute('role') === 'tablist';
    Object.defineProperty(HTMLElement.prototype, 'scrollLeft', {
      configurable: true,
      get(this: HTMLElement) { return isRow(this) ? state.scrollLeft : 0; },
      set(this: HTMLElement, value: number) { if (isRow(this)) { state.scrollLeft = value; writes.push(value); } },
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (isRow(this)) return { ...tabBox(ROW.left), right: ROW.right, width: ROW.right - ROW.left };
      return this.getAttribute('aria-selected') === 'true' ? tabBox(state.tabLeft) : tabBox(0);
    });
    const original = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element, pseudo?: string | null) =>
      element.getAttribute('role') === 'tablist' ? ({ scrollPaddingLeft: `${ZONE_PX}px` } as CSSStyleDeclaration) : original(element, pseudo),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollLeft');
  });

  it('moves the row clear of the end fade when the tab lies 0.0156 px past the end of the row', () => {
    // Raden är scrollad en bit och har mer innehåll åt höger: slutfaden ritas. Fliken ligger 0,0156 px förbi radens högerkant.
    state.scrollLeft = 100;
    state.tabLeft = ROW.right - SELECTED_WIDTH + 0.0156;
    render(<Row selected="b" count={3} />);

    expect(endFade()).toBe('true');
    expect(state.scrollLeft, 'the row is scrolled on to give the tab the width of the fade zone').toBeGreaterThanOrEqual(100 + ZONE_PX - 1);
  });

  it('moves the row clear of the start fade when the tab lies 0.0156 px before the start of the row', () => {
    state.scrollLeft = 100;
    state.tabLeft = ROW.left - 0.0156;
    render(<Row selected="b" count={3} />);

    expect(screen.getByTestId('wrap').getAttribute('data-fade-start')).toBe('true');
    expect(state.scrollLeft, 'the row is scrolled back to give the tab the width of the fade zone').toBeLessThanOrEqual(100 - ZONE_PX + 1);
  });

  it('leaves a tab that is not in view to the reveal, which ViewTabs owns', () => {
    state.scrollLeft = 100;
    state.tabLeft = ROW.right + 30;
    render(<Row selected="b" count={3} />);

    expect(writes).toEqual([]);
  });
});
