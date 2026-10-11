import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import BadgesPage from './BadgesPage';
import { renderWithApp } from '@/test/renderApp';

const MOBILE = 390;
const DESKTOP = 1280;

describe('BadgesPage (skal tills RUN-150)', () => {
  it('har rubriken Badges som h1', () => {
    renderWithApp(<BadgesPage />, { entry: '/badges', width: MOBILE });
    expect(screen.getByRole('heading', { level: 1, name: 'Badges' })).toBeInTheDocument();
  });

  it('mobil: tillbaka-länken ‹ går till /profile', async () => {
    renderWithApp(<BadgesPage />, { entry: '/badges', width: MOBILE });

    const back = screen.getByRole('link', { name: 'Back' });
    expect(back).toHaveAttribute('href', '/profile');
    fireEvent.click(back);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/profile'));
  });

  it('desktop: ingen tillbaka-länk (sidonavet är vägen tillbaka)', () => {
    renderWithApp(<BadgesPage />, { entry: '/badges', width: DESKTOP });
    expect(screen.getByRole('heading', { level: 1, name: 'Badges' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Back' })).toBeNull();
  });
});
