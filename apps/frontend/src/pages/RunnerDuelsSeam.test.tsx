import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Link, Route, Routes } from 'react-router-dom';
import type { HeadToHeadResponse } from '@runquest/shared';
import DuelsPage from './DuelsPage';
import RunnerRoute from './RunnerPage';
import { stat, token } from '@/features/challenges/duels.fixture';
import { ME, OTHER, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, type AuthContextType } from '@/providers/authContext';
import { LocationProbe } from '@/test/LocationProbe';
import { setViewportWidth } from '@/test/viewport';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));

// Skarven Runner card ↔ Duels med EN delad QueryClient (renderWithApp skapar en per rendering): båda läser head-to-head under samma
// query-nyckel och måste därför cacha samma dataform. Regression: Duels cachade { id, record } och Runner kraschade (vit skärm).

const H2H: HeadToHeadResponse = {
  opponent: { id: OTHER.id, name: OTHER.name, profile_picture: null },
  record: { wins: 2, draws: 0, losses: 1, total: 3 },
  history: [],
  active: null,
};

// Som renderWithApp, men med DEFAULT gcTime: renderWithApp har gcTime 0, så en query raderas så fort sidan som läste den avmonteras —
// då delas ingen cache mellan sidorna och skarven kan inte provas.
function renderWithSharedCache(ui: ReactNode, entry: string) {
  setViewportWidth(390);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const auth: AuthContextType = {
    user: { id: ME.id, name: ME.name, email: 'joel@example.com', is_admin: false },
    login: async () => ({ success: true }), logout: () => {}, loading: false, isAdmin: false,
  };
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[entry]}>
          {ui}
          <LocationProbe />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

function renderSeam() {
  return renderWithSharedCache(
    <Routes>
      <Route path="/runner/:id" element={<RunnerRoute presentation="page" />} />
      <Route
        path="/duels"
        element={
          <>
            <DuelsPage />
            <Link to={`/runner/${OTHER.id}`}>back to runner</Link>
          </>
        }
      />
    </Routes>,
    `/runner/${OTHER.id}`,
  );
}

beforeEach(() => {
  resetFakeBackend();
  handlers.getUsersWithRuns = () => ({ success: true, data: [ME, OTHER] });
  handlers.getMyChallenges = () => ({
    success: true,
    data: { tokens: [token({ id: 't1' })], sent_challenge: null, received_challenges: [], boosts: [], history: [], group_active: [] },
  });
  handlers.getChallengeGroupStats = () => ({ success: true, data: [stat(ME.id, { name: ME.name }), stat(OTHER.id, { name: OTHER.name })] });
});

describe('Runner card ↔ Duels delar head-to-head-cachen', () => {
  it('Runner → Challenge → sheet (tips ur Runners cache) → Send → tillbaka till Runner: panelen ritas, ingen krasch', async () => {
    const calls: unknown[][] = [];
    handlers.getHeadToHead = (...args: unknown[]) => {
      calls.push(args);
      return { success: true, data: H2H };
    };
    handlers.sendChallenge = () => ({ success: true, data: { challenge_id: 'new' } });
    renderSeam();

    // 1. Runner card har hämtat head-to-head (hela svaret).
    const panel = await screen.findByRole('region', { name: 'Head to head' });
    expect(await within(panel).findByText('you won')).toBeInTheDocument();
    const callsAfterRunner = calls.length;

    // 2. Challenge → sheeten med motståndaren förvald. Tipset kommer ur Runners cache (rätt form), inte "never met"/tomt.
    fireEvent.click(screen.getByRole('link', { name: 'Challenge' }));
    const sheet = await screen.findByRole('dialog', { name: 'Send a challenge' });
    expect(await within(sheet).findByText('2–1 to you')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: new RegExp(OTHER.name) })).toHaveAttribute('aria-pressed', 'true');
    expect(calls.length).toBe(callsAfterRunner); // färsk cache → ingen omhämtning

    // 3. Send → refresh() invaliderar head-to-head → tillbaka till Runner.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send challenge' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('link', { name: 'back to runner' }));

    // 4. Runner ritar head-to-head igen utan att kasta (förut: tom #root).
    const again = await screen.findByRole('region', { name: 'Head to head' });
    expect(await within(again).findByText('you won')).toBeInTheDocument();
  });

  it('omvänt: Duels-sheeten först, sedan Runner — Runner läser Duels cache och ritar rätt', async () => {
    handlers.getHeadToHead = () => ({ success: true, data: H2H });
    renderWithSharedCache(
      <Routes>
        <Route path="/runner/:id" element={<RunnerRoute presentation="page" />} />
        <Route
          path="/duels"
          element={
            <>
              <DuelsPage />
              <Link to={`/runner/${OTHER.id}`}>to runner</Link>
            </>
          }
        />
      </Routes>,
      `/duels?send=1&opponent=${OTHER.id}`,
    );
    const sheet = await screen.findByRole('dialog', { name: 'Send a challenge' });
    expect(await within(sheet).findByText('2–1 to you')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('link', { name: 'to runner' }));
    const panel = await screen.findByRole('region', { name: 'Head to head' });
    expect(await within(panel).findByText('you won')).toBeInTheDocument();
  });
});
