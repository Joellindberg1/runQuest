import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ArenaTrack } from './ArenaTrack';

const count = (root: Element, selector: string) => root.querySelectorAll(selector).length;
const popLabels = (root: Element) => [...root.querySelectorAll('text[data-runner]')].map((text) => text.textContent);

/** Båda geometrierna ligger i HTML (förrenderingen vet inte skärmbredden); CSS visar en. Testet hittar dem på sin variant, inte på bredd. */
function renderArena() {
  const { container } = render(<ArenaTrack />);
  const desktop = container.querySelector('svg[data-arena="desktop"]') as SVGElement;
  const mobile = container.querySelector('svg[data-arena="mobile"]') as SVGElement;
  return { container, desktop, mobile };
}

describe('ArenaTrack', () => {
  it('renderar båda banorna oavsett skärmbredd: desktop med fem banor och sex löpare, mobil med tre', () => {
    const { container, desktop, mobile } = renderArena();
    expect(count(container, 'svg')).toBe(2);

    expect(count(desktop, 'path[data-lane]')).toBe(5);
    expect(count(desktop, 'circle[data-runner]')).toBe(6);
    expect(popLabels(desktop)).toEqual(['+50 XP', '+35 XP', '+25 XP', '+107 XP', '+30 XP', '+19 XP']);

    expect(count(mobile, 'path[data-lane]')).toBe(3);
    expect(count(mobile, 'circle[data-runner]')).toBe(3);
    expect(popLabels(mobile)).toEqual(['+50 XP']);
  });

  it('är ren dekor: gömd för skärmläsare och utan egna bilder eller fokuserbara delar', () => {
    const { container } = renderArena();
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root.querySelector('[tabindex], a, button')).toBeNull();
  });
});
