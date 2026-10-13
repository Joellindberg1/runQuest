import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useScrollToHash } from './useScrollToHash';

function Probe() {
  useScrollToHash();
  return (
    <>
      <section id="privacy">Privacy</section>
      <section id="terms">Terms</section>
    </>
  );
}

const stubReducedMotion = (reduced: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && /prefers-reduced-motion/.test(query),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Probe />
    </MemoryRouter>,
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useScrollToHash', () => {
  it('scrolls the anchored section into view after rendering, smoothly by default', () => {
    stubReducedMotion(false);
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    scroll.mockClear();
    const { container } = renderAt('/legal#terms');
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(container.querySelector('#terms'));
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('scrolls without animation when the visitor prefers reduced motion', () => {
    stubReducedMotion(true);
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    scroll.mockClear();
    renderAt('/legal#privacy');
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });

  it('does nothing without a hash or when the anchor does not exist', () => {
    stubReducedMotion(false);
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    scroll.mockClear();
    renderAt('/legal');
    renderAt('/legal#nowhere');
    expect(scroll).not.toHaveBeenCalled();
  });
});
