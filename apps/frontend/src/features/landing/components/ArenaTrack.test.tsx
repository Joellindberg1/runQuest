import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { setViewportWidth } from '@/test/viewport';
import { ArenaTrack } from './ArenaTrack';

const renderArena = (width: number) => {
  setViewportWidth(width);
  return render(<ArenaTrack />);
};

const count = (container: HTMLElement, selector: string) => container.querySelectorAll(selector).length;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ArenaTrack', () => {
  it('desktopbanan har fem banor och sex löpare och mobilbanan tre', () => {
    const desktop = renderArena(1440);
    expect(count(desktop.container, 'path[data-lane]')).toBe(5);
    expect(count(desktop.container, 'circle[data-runner]')).toBe(6);
    expect(count(desktop.container, 'text[data-runner]')).toBe(6);
    expect([...desktop.container.querySelectorAll('text[data-runner]')].map((text) => text.textContent)).toEqual([
      '+50 XP', '+35 XP', '+25 XP', '+107 XP', '+30 XP', '+19 XP',
    ]);
    desktop.unmount();

    const mobile = renderArena(390);
    expect(count(mobile.container, 'path[data-lane]')).toBe(3);
    expect(count(mobile.container, 'circle[data-runner]')).toBe(3);
    expect([...mobile.container.querySelectorAll('text[data-runner]')].map((text) => text.textContent)).toEqual(['+50 XP']);
  });

  it('är ren dekor: gömd för skärmläsare och utan egna bilder eller fokuserbara delar', () => {
    const { container } = renderArena(1440);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root.querySelector('[tabindex], a, button')).toBeNull();
  });
});
