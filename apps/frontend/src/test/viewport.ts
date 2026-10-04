import { vi } from 'vitest';

/** Mockad matchMedia för `(min-width: Npx)`-frågor — räcker för skalets brytpunkt (1024 px). */
export function setViewportWidth(width: number): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string): MediaQueryList => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      const matches = min ? width >= Number(min[1]) : false;
      return {
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      } as unknown as MediaQueryList;
    },
  );
  window.matchMedia = globalThis.matchMedia;
}
