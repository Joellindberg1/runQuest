import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StagingBanner } from './StagingBanner';

// Remsan är en vanlig rad överst, så sidans 100dvh-ytor måste räkna bort dess höjd (--rq-staging-banner-h) för att sidan inte ska bli högre än fönstret.
// jsdom har ingen layout: offsetHeight ersätts med ett känt mått.
const BANNER_HEIGHT = 22;
const root = document.documentElement;
const reserved = () => root.style.getPropertyValue('--rq-staging-banner-h');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the staging banner component', () => {
  it('tells the user this is the staging environment', () => {
    render(<StagingBanner />);
    expect(screen.getByRole('complementary', { name: 'Staging environment' })).toHaveTextContent(/staging/i);
  });

  it('reserves its own height on the page while it is shown and gives it back when it goes', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(BANNER_HEIGHT);
    const { unmount } = render(<StagingBanner />);
    expect(reserved()).toBe(`${BANNER_HEIGHT}px`);
    unmount();
    expect(reserved()).toBe('');
  });
});
