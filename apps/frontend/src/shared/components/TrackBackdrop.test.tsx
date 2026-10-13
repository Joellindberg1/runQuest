import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { TrackBackdrop } from './TrackBackdrop';

describe('TrackBackdrop', () => {
  it('is hidden from assistive technology and holds no interactive content', () => {
    const { container } = render(<TrackBackdrop />);
    const root = container.firstElementChild as HTMLElement;

    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root.querySelectorAll('a, button, input, select, textarea, [tabindex]')).toHaveLength(0);
    expect(root.textContent).toBe('');
  });

  it('draws the four lanes, the finish line and three runners (gold, silver, bronze)', () => {
    const { container } = render(<TrackBackdrop />);

    expect(container.querySelectorAll('[data-lane]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-finish]')).toHaveLength(1);
    expect(Array.from(container.querySelectorAll('[data-runner]')).map((dot) => dot.getAttribute('data-runner'))).toEqual(['1', '2', '3']);
  });

  it('moves its runners with CSS only, so that reduced motion can switch them off', () => {
    const { container } = render(<TrackBackdrop />);

    expect(container.querySelector('animateMotion, animatemotion, animate, set')).toBeNull();
  });
});
