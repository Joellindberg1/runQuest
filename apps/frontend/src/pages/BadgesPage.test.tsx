import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import BadgesPage from './BadgesPage';
import { renderWithApp } from '@/test/renderApp';

// Sidan är tunn (RUN-150): rubriken, den mobila tillbaka-länken och att brytpunkten läses innan något beroende ritas bor i BadgesScreen och testas här genom sidan.
// useIsDesktop styrs direkt (true / false / undefined), så även läget "inte läst än" (ADR 006 risk 6) kan provas.

const api = vi.hoisted(() => ({ getUserBadges: vi.fn(), getGroupBadges: vi.fn(), saveShowcase: vi.fn() }));
vi.mock('@/features/badges/api', () => ({ badgesApi: api }));
const viewport = vi.hoisted(() => ({ isDesktop: false as boolean | undefined }));
vi.mock('@/app-shell/useIsDesktop', () => ({ useIsDesktop: () => viewport.isDesktop }));

const backLink = () => screen.queryByRole('link', { name: 'Back to profile' });

beforeEach(() => {
  viewport.isDesktop = false;
  api.getUserBadges.mockReset();
  api.getGroupBadges.mockReset();
  api.saveShowcase.mockReset();
  api.getUserBadges.mockResolvedValue({ items: [], showcase: [] });
  api.getGroupBadges.mockResolvedValue({ members: [], holders: {}, member_count: 0 });
});

describe('BadgesPage', () => {
  it('har rubriken Badges som h1 med den sidspecifika titelklassen rq-badges__title', () => {
    renderWithApp(<BadgesPage />, { entry: '/badges' });
    expect(screen.getByRole('heading', { level: 1, name: 'Badges' })).toHaveClass('rq-display', 'rq-badges__title');
  });

  it('mobil: tillbaka-länken ‹ går till /profile', async () => {
    renderWithApp(<BadgesPage />, { entry: '/badges' });

    const back = backLink();
    expect(back).toHaveAttribute('href', '/profile');
    fireEvent.click(back as HTMLElement);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/profile'));
  });

  it('desktop: ingen tillbaka-länk (sidonavet är vägen tillbaka)', () => {
    viewport.isDesktop = true;
    renderWithApp(<BadgesPage />, { entry: '/badges' });
    expect(screen.getByRole('heading', { level: 1, name: 'Badges' })).toBeInTheDocument();
    expect(backLink()).toBeNull();
  });

  // Mutationen `!isDesktop` i stället för `isDesktop === false` ritar länken här: den fälls av testet.
  it('useIsDesktop === undefined (inte läst än): ingen tillbaka-länk och ingen bredd-beroende text — rubriken finns ändå', async () => {
    viewport.isDesktop = undefined;
    renderWithApp(<BadgesPage />, { entry: '/badges' });
    expect(screen.getByRole('heading', { level: 1, name: 'Badges' })).toBeInTheDocument();
    expect(backLink()).toBeNull();
    expect(screen.queryByText(/Anyone can hold a badge/)).toBeNull();
    // Även sedan datan har landat: brytpunkten är fortfarande oläst.
    await screen.findByRole('heading', { name: 'No badges yet' });
    expect(backLink()).toBeNull();
    expect(screen.queryByText(/series unlocked/)).toBeNull();
  });
});
