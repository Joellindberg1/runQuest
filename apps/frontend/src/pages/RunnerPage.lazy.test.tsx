import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import RunnerRoute from './RunnerPage';
import { ME, OTHER, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));
vi.mock('@/features/badges/api', () => ({
  badgesApi: {
    getUserBadges: async () => ({ items: [], showcase: [] }),
    getGroupBadges: async () => ({ members: [], holders: {}, member_count: 0 }),
  },
}));

// Popupens chunk hålls tillbaka tills provet släpper den. Importeras RunnerPopup statiskt väntar modulgrafen på fabriken och filen kommer aldrig förbi insamlingen; bara
// en dynamisk import (React.lazy) låter sidan visa skrim och laddare medan chunken hämtas.
const popupChunk = vi.hoisted(() => {
  let release: () => void = () => {};
  const loaded = new Promise<void>((resolve) => { release = resolve; });
  return { loaded, release };
});
vi.mock('@/features/runner/components/RunnerPopup', async (importOriginal) => {
  await popupChunk.loaded;
  return importOriginal();
});

beforeEach(() => {
  resetFakeBackend();
  handlers.getUsersWithRuns = () => ({ success: true, data: [ME, OTHER] });
  handlers.getUserTitles = () => ({ success: true, data: [] });
  handlers.getTitleLeaderboard = () => ({ success: true, data: [] });
});

describe('the profile popup is a lazy chunk', () => {
  it('shows the scrim and a loading state first, and the dialog when the chunk has loaded', async () => {
    renderWithApp(
      <Routes>
        <Route path="/runner/:id" element={<RunnerRoute presentation="overlay" />} />
      </Routes>,
      { entry: '/runner/u-karl', width: 1280 },
    );

    expect(await screen.findByText('Loading runner')).toBeInTheDocument();
    expect(document.querySelector('.rq-scrim')).not.toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    popupChunk.release();
    const dialog = await screen.findByRole('dialog', { name: `Runner card: ${OTHER.name}` });
    expect(await within(dialog).findByRole('region', { name: "Frodo's journey" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Loading runner')).toBeNull());
  });
});
