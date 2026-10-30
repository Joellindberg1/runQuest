import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { zoneDay } from '@runquest/shared';
import { ME } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import { run, user } from '../profile.fixture';
import { Heatmap } from './Heatmap';

// 12:00 i Stockholm, 2026-10-04. Den inloggade (ME) är någon annan än löparen som ritas.
const NOW = new Date('2026-10-04T10:00:00Z');

const runner = user({
  id: 'u-karl',
  name: 'Karl Persson',
  total_xp: 5539,
  current_streak: 2,
  longest_streak: 9,
  runs: [
    run({ id: 'k1', user_id: 'u-karl', date: '2026-10-03', distance: 12 }),
    run({ id: 'k2', user_id: 'u-karl', date: '2026-10-02', distance: 5 }),
    run({ id: 'k3', user_id: 'u-karl', date: '2026-09-20', distance: 8 }),
  ],
});

describe('Heatmap', () => {
  it("renders another user's runs from its props", () => {
    expect(ME.id).not.toBe(runner.id);
    renderWithApp(<Heatmap user={runner} today={zoneDay(NOW)} now={NOW} isDesktop />);

    // Sammanfattningen och summan kommer ur Karls rundor, inte ur den inloggades.
    expect(screen.getByRole('region', { name: /^Run heatmap: 3 runs on 3 of \d+ days$/ })).toBeInTheDocument();
    expect(screen.getByText(/^runs in the last \d+ months$/).previousElementSibling).toHaveTextContent('3');
    expect(screen.getByRole('img', { name: '2026-10-03 · 12.0 km · 1 run' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '2026-09-20 · 8.0 km · 1 run' })).toBeInTheDocument();
    expect(screen.getByText('longest streak').nextElementSibling).toHaveTextContent('9');
    expect(screen.getByText('current streak').nextElementSibling).toHaveTextContent('2');
  });
});

// jsdom har ingen layout: bredderna sätts för hand (mätt i riktig webbläsare vid 1440 px: 681/681).
function withWidths(scrollWidth: number, clientWidth: number) {
  const sw = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth');
  const cw = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
  Object.defineProperty(Element.prototype, 'scrollWidth', { configurable: true, get: () => scrollWidth });
  Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: () => clientWidth });
  return () => {
    if (sw) Object.defineProperty(Element.prototype, 'scrollWidth', sw); else delete (Element.prototype as unknown as Record<string, unknown>).scrollWidth;
    if (cw) Object.defineProperty(Element.prototype, 'clientWidth', cw); else delete (Element.prototype as unknown as Record<string, unknown>).clientWidth;
  };
}

describe('the scroll region of Heatmap', () => {
  const region = () => screen.getByRole('region', { name: /^Run heatmap/ });

  it('is no tab stop while the map fits, since there is nothing to pan', () => {
    const restore = withWidths(686, 681);
    try {
      renderWithApp(<Heatmap user={runner} today={zoneDay(NOW)} now={NOW} isDesktop />);
      expect(region()).toHaveAttribute('data-fits', 'true');
      expect(region()).not.toHaveAttribute('tabindex');
    } finally {
      restore();
    }
  });

  it('is a tab stop when the map really scrolls, so that it can be panned with the keyboard', () => {
    const restore = withWidths(666, 521);
    try {
      renderWithApp(<Heatmap user={runner} today={zoneDay(NOW)} now={NOW} isDesktop />);
      expect(region()).toHaveAttribute('data-fits', 'false');
      expect(region()).toHaveAttribute('tabindex', '0');
    } finally {
      restore();
    }
  });
});

describe('the growing-in of Heatmap', () => {
  const root = (container: HTMLElement) => container.querySelector('.rq-profile-heat');

  it('plays on every mount, and carries no data-intro, when the host does not track it (the profile)', () => {
    for (let mount = 0; mount < 2; mount += 1) {
      const { container, unmount } = renderWithApp(<Heatmap user={runner} today={zoneDay(NOW)} now={NOW} isDesktop />);
      expect(root(container)).not.toHaveAttribute('data-intro');
      unmount();
    }
  });

  it('plays only the first time for a host that shares one flag between its mounts (the popup)', () => {
    const played = { current: false };
    const first = renderWithApp(<Heatmap user={runner} today={zoneDay(NOW)} now={NOW} isDesktop introPlayed={played} />);
    expect(root(first.container)).toHaveAttribute('data-intro', 'true');
    expect(played.current).toBe(true);
    first.unmount();

    const second = renderWithApp(<Heatmap user={runner} today={zoneDay(NOW)} now={NOW} isDesktop introPlayed={played} />);
    expect(root(second.container)).toHaveAttribute('data-intro', 'false');
  });
});
