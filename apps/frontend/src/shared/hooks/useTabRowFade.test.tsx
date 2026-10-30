import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useTabRowFade } from './useTabRowFade';

// Kantfaden mäts ur radens scrollmått. Typsnittet kan komma efter första mätningen (reservtypsnittet är bredare, så innehållet krymper när det riktiga laddat) utan att radens
// egen box ändras: då triggas varken scroll eller en observer på raden. Raden mäts därför om när typsnitten laddat, och när en flik byter storlek. jsdom har ingen layout och
// inget `document.fonts`, så måtten och typsnittsobjektet lånas ut.

const layout = { client: 282, scroll: 430 };

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
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get(this: HTMLElement) { return isRow(this) ? layout.client : 0; } });
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
    await act(async () => {
      fontsLoaded();
      await Promise.resolve();
    });
  });

  it('works where the browser has no font set to wait for', () => {
    renderRow();

    expect(endFade()).toBe('true');
  });
});
