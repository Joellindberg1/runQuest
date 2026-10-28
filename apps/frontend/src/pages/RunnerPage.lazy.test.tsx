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

// Popupens innehåll hålls tillbaka tills provet släpper det. Importeras RunnerPopup statiskt väntar modulgrafen på fabriken och filen kommer aldrig förbi insamlingen; bara
// en dynamisk import (React.lazy) låter dialogramen ritas medan innehållet väntar.
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

describe('the profile popup content is a lazy chunk', () => {
  it('draws the dialog frame and a loading state first, and the content when the chunk has loaded', async () => {
    renderWithApp(
      <Routes>
        <Route path="/runner/:id" element={<RunnerRoute presentation="overlay" />} />
      </Routes>,
      { entry: '/runner/u-karl', width: 1280 },
    );

    const dialog = await screen.findByRole('dialog', { name: `Runner card: ${OTHER.name}` });
    expect(within(dialog).getByText('Loading runner')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('region', { name: "Frodo's journey" })).toBeNull();

    popupChunk.release();
    expect(await within(dialog).findByRole('region', { name: "Frodo's journey" })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).queryByText('Loading runner')).toBeNull());
  });
});
