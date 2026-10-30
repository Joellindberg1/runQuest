import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
// en dynamisk import (React.lazy) låter sidan visa skrim och laddare medan chunken hämtas. Modulen laddas en gång per fil: proven av laddläget kommer därför FÖRE provet som
// släpper chunken, och det sista provet i filen är det som släpper den.
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

// Väntläget heter "Runner card" medan löparen är okänd och "Loading <namn>'s runner card" när hen är känd (cachad grupp): provet ska inte bero på vilket.
const PENDING_NAME = /^(Runner card|Loading .+'s runner card)$/;

const location = () => screen.getByTestId('location').textContent;

function renderPending() {
  return renderWithApp(
    <Routes>
      <Route path="/runner/:id" element={<RunnerRoute presentation="overlay" />} />
      <Route path="/board" element={<div>Board page</div>} />
    </Routes>,
    { entry: '/runner/u-karl', width: 1280 },
  );
}

describe('the profile popup is a lazy chunk', () => {
  it('while the chunk loads, the loading state is a busy dialog over the scrim', async () => {
    renderPending();

    const dialog = await screen.findByRole('dialog', { name: PENDING_NAME });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    expect(within(dialog).getByText('Loading runner')).toBeInTheDocument();
    expect(document.querySelector('.rq-scrim')).not.toBeNull();
  });

  it('while the chunk loads, focus moves into the dialog and Tab does not release it to the page behind', async () => {
    const user = userEvent.setup();
    renderWithApp(
      <>
        <button type="button">Behind the popup</button>
        <Routes>
          <Route path="/runner/:id" element={<RunnerRoute presentation="overlay" />} />
        </Routes>
      </>,
      { entry: '/runner/u-karl', width: 1280 },
    );

    const dialog = await screen.findByRole('dialog', { name: PENDING_NAME });
    await waitFor(() => expect(dialog).toHaveFocus());

    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole('button', { name: 'Behind the popup', hidden: true })).not.toHaveFocus();
  });

  it('while the chunk loads, Escape closes the popup', async () => {
    renderPending();
    const dialog = await screen.findByRole('dialog', { name: PENDING_NAME });
    await waitFor(() => expect(dialog).toHaveFocus());

    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(location()).toBe('/board'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('while the chunk loads, a click on the scrim closes the popup', async () => {
    renderPending();
    await screen.findByRole('dialog', { name: PENDING_NAME });

    fireEvent.click(document.querySelector('.rq-scrim') as HTMLElement);

    await waitFor(() => expect(location()).toBe('/board'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the real dialog, not busy, when the chunk has loaded', async () => {
    renderPending();
    expect(await screen.findByText('Loading runner')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: `Runner card: ${OTHER.name}` })).toBeNull();

    popupChunk.release();
    const dialog = await screen.findByRole('dialog', { name: `Runner card: ${OTHER.name}` });
    expect(dialog).not.toHaveAttribute('aria-busy');
    await waitFor(() => expect(within(dialog).getByRole('heading', { level: 2, name: `Runner card: ${OTHER.name}` })).toHaveFocus());
    expect(await within(dialog).findByRole('tab', { name: 'The Journey' })).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText('Loading runner')).toBeNull());
  });
});
