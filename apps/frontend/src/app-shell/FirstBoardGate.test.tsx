import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { FirstBoardGate, FIRST_BOARD_DATA_MAX_WAIT_MS } from './FirstBoardGate';
import { useSeasonBoardData } from '@/features/leaderboard/hooks/useSeasonBoardData';
import { AuthContext, type AuthContextType } from '@/providers/authContext';
import { USERS_WITH_RUNS_QUERY_KEY } from '@/shared/hooks/useUsersWithRuns';
import { ME, OTHER, RANK_DELTA, handlers, resetFakeBackend } from '@/test/fakeBackend';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
// Gruppens badges (minis i podiekorten) går genom badges-klienten, inte backendApi.
const badgesApi = vi.hoisted(() => ({ getGroupBadges: vi.fn() }));
vi.mock('@/features/badges/api', () => ({ badgesApi }));

const BADGES = { members: [{ user_id: ME.id, showcase: [{ series: 'milestoner', tier: 2 }] }], holders: {}, member_count: 2 };

// Gaten sitter över skalet i routeträdet. Sidorna här är minimala: gaten ska hålla undan hela trädet under den, inte bara en viss sida. Board-stubben läser
// samma frågor som Season-vyn (useSeasonBoardData), så att "hämtas inte om" provas mot de riktiga cache-nycklarna.
function BoardStub() {
  const { usersQuery } = useSeasonBoardData();
  const queryClient = useQueryClient();
  return (
    <main>
      <p>board page, {usersQuery.data ? `${usersQuery.data.length} runners` : 'no data yet'}</p>
      <button type="button" onClick={() => void queryClient.invalidateQueries({ queryKey: USERS_WITH_RUNS_QUERY_KEY })}>
        refresh in the background
      </button>
      <Link to="/titles">to titles</Link>
    </main>
  );
}

const TitlesStub = () => (
  <main>
    <p>titles page</p>
    <Link to="/board">to board</Link>
  </main>
);

// Utanför gaten: byter adress medan gaten håller, som bakåtknappen gör.
function LeaveTo({ path }: { path: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(path)}>
      leave the board
    </button>
  );
}

const auth: AuthContextType = {
  user: { id: ME.id, name: ME.name, email: 'joel@example.com', is_admin: false },
  login: async () => ({ success: true }),
  logout: () => {},
  loading: false,
  isAdmin: false,
};

const newClient = (retry: number | false = false, retryDelay = 0) => new QueryClient({ defaultOptions: { queries: { retry, retryDelay, gcTime: Infinity } } });

function renderGate(entry: string, client = newClient()) {
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[entry]}>
          <LeaveTo path="/titles" />
          <Routes>
            <Route element={<FirstBoardGate />}>
              <Route path="/board" element={<BoardStub />} />
              <Route path="/titles" element={<TitlesStub />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const loadingView = () => screen.queryByRole('status');
const GROUP = { success: true, data: [ME, OTHER] };
const TITLES = { success: true, data: [] };
const RANKS = { success: true, data: RANK_DELTA };

beforeEach(() => {
  resetFakeBackend();
  badgesApi.getGroupBadges.mockReset();
  badgesApi.getGroupBadges.mockResolvedValue(BADGES);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the first load of the board', () => {
  it('shows the loading view, and not the page, until the first answer with the standings arrives', async () => {
    const answer = deferred<typeof GROUP>();
    handlers.getUsersWithRuns = () => answer.promise;
    renderGate('/board');

    expect(loadingView()).toHaveTextContent('Loading');
    expect(screen.queryByText(/board page/)).not.toBeInTheDocument();

    await act(async () => answer.resolve(GROUP));

    expect(await screen.findByText('board page, 2 runners')).toBeInTheDocument();
    expect(loadingView()).not.toBeInTheDocument();
  });

  it.each([
    ['titles', () => {
      const held = deferred<typeof TITLES>();
      handlers.getUserTitles = () => held.promise;
      return () => held.resolve(TITLES);
    }],
    ['rank arrows', () => {
      const held = deferred<typeof RANKS>();
      handlers.getRankDelta = () => held.promise;
      return () => held.resolve(RANKS);
    }],
    ['badge minis', () => {
      const held = deferred<typeof BADGES>();
      badgesApi.getGroupBadges.mockReturnValue(held.promise);
      return () => held.resolve(BADGES);
    }],
  ])('keeps the loading view after the standings arrive until the %s have arrived too', async (_part, hold) => {
    const release = hold();
    renderGate('/board');
    // Gruppen svarar direkt; bara den hållna delen saknas, och sidan får inte ritas utan den.
    await waitFor(() => expect(badgesApi.getGroupBadges).toHaveBeenCalled());
    await act(async () => {});

    expect(loadingView()).toHaveTextContent('Loading');
    expect(screen.queryByText(/board page/)).not.toBeInTheDocument();

    await act(async () => release());

    expect(await screen.findByText('board page, 2 runners')).toBeInTheDocument();
    expect(loadingView()).not.toBeInTheDocument();
  });

  it('replaces the loading view with the page when the first fetch fails, so it is never endless', async () => {
    handlers.getUsersWithRuns = () => ({ success: false, error: 'boom' });
    renderGate('/board');

    expect(await screen.findByText('board page, no data yet')).toBeInTheDocument();
    expect(loadingView()).not.toBeInTheDocument();
  });

  it('replaces the loading view with the page at the first failed attempt, without waiting for the retries', async () => {
    // Omförsöken pågår (nästa om en minut). Skulle gaten vänta på dem och sedan släppa, startar Boards nya observatörer om hämtningen och felvyn dröjer dubbelt.
    handlers.getUsersWithRuns = () => ({ success: false, error: 'boom' });
    const client = newClient(3, 60_000);
    renderGate('/board', client);

    expect(await screen.findByText('board page, no data yet')).toBeInTheDocument();
    expect(loadingView()).not.toBeInTheDocument();
    client.clear();
  });

  it.each([
    ['rank arrows', () => { handlers.getRankDelta = () => ({ success: false, error: 'boom' }); }],
    ['badge minis', () => { badgesApi.getGroupBadges.mockRejectedValue(new Error('boom')); }],
  ])('replaces the loading view with the page when the %s fail, even though everything else is still on its way', async (_part, fail) => {
    handlers.getUserTitles = () => new Promise(() => {});
    fail();
    renderGate('/board');

    expect(await screen.findByText('board page, 2 runners')).toBeInTheDocument();
    expect(loadingView()).not.toBeInTheDocument();
  });

  it('replaces the loading view with the page after the longest wait when the answer never comes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    handlers.getUsersWithRuns = () => new Promise(() => {});
    renderGate('/board');

    await act(() => vi.advanceTimersByTimeAsync(FIRST_BOARD_DATA_MAX_WAIT_MS - 1));
    expect(loadingView()).toBeInTheDocument();
    expect(screen.queryByText(/board page/)).not.toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText('board page, no data yet')).toBeInTheDocument();
    expect(loadingView()).not.toBeInTheDocument();
  });

  it('counts the longest wait from the start for the whole chain, not from when the standings arrive', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const group = deferred<typeof GROUP>();
    handlers.getUsersWithRuns = () => group.promise;
    handlers.getUserTitles = () => new Promise(() => {});
    renderGate('/board');

    await act(() => vi.advanceTimersByTimeAsync(FIRST_BOARD_DATA_MAX_WAIT_MS - 3_000));
    await act(async () => group.resolve(GROUP));
    expect(loadingView()).toBeInTheDocument();

    // Titlarna svarar aldrig: sidan ritas ändå när 8 s gått från starten, inte 8 s efter gruppen.
    await act(() => vi.advanceTimersByTimeAsync(2_999));
    expect(loadingView()).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText('board page, 2 runners')).toBeInTheDocument();
    expect(loadingView()).not.toBeInTheDocument();
  });

  it('does not wait for titles, arrows and minis in the week view, which does not draw them', async () => {
    handlers.getUserTitles = () => new Promise(() => {});
    handlers.getRankDelta = () => new Promise(() => {});
    badgesApi.getGroupBadges.mockReturnValue(new Promise(() => {}));
    renderGate('/board?view=week');

    expect(await screen.findByText('board page, 2 runners')).toBeInTheDocument();
    expect(loadingView()).not.toBeInTheDocument();
  });

  it('does not wait for titles when the group has no runners to ask about', async () => {
    handlers.getUsersWithRuns = () => ({ success: true, data: [] });
    renderGate('/board');

    expect(await screen.findByText('board page, 0 runners')).toBeInTheDocument();
    expect(loadingView()).not.toBeInTheDocument();
  });

  it('hands the data over to the page without asking for any of it again', async () => {
    const standings = vi.fn(() => GROUP);
    const titles = vi.fn(() => TITLES);
    const ranks = vi.fn(() => RANKS);
    handlers.getUsersWithRuns = standings;
    handlers.getUserTitles = titles;
    handlers.getRankDelta = ranks;
    renderGate('/board');

    await screen.findByText('board page, 2 runners');
    await act(async () => {});

    expect(standings).toHaveBeenCalledTimes(1);
    expect(titles).toHaveBeenCalledTimes(GROUP.data.length);
    expect(ranks).toHaveBeenCalledTimes(1);
    expect(badgesApi.getGroupBadges).toHaveBeenCalledTimes(1);
  });

  it('lets go when the visitor leaves the board while it is held, so the loading view never stands on another page', async () => {
    handlers.getUsersWithRuns = () => new Promise(() => {});
    renderGate('/board');
    expect(loadingView()).toHaveTextContent('Loading');

    await userEvent.click(screen.getByRole('button', { name: 'leave the board' }));

    expect(screen.getByText('titles page')).toBeInTheDocument();
    expect(loadingView()).not.toBeInTheDocument();
  });

  it('does not show the loading view when the standings are already in the cache', () => {
    const client = newClient();
    client.setQueryData(USERS_WITH_RUNS_QUERY_KEY, [ME]);
    handlers.getUserTitles = () => new Promise(() => {});
    renderGate('/board', client);

    expect(screen.getByText('board page, 1 runners')).toBeInTheDocument();
    expect(loadingView()).not.toBeInTheDocument();
  });

});

describe('later in the session', () => {
  it('does not show the loading view when the first page is another one and the board is opened from it', async () => {
    handlers.getUsersWithRuns = () => new Promise(() => {});
    renderGate('/titles');
    expect(screen.getByText('titles page')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'to board' }));

    expect(screen.getByText('board page, no data yet')).toBeInTheDocument();
    expect(loadingView()).not.toBeInTheDocument();
  });

  it('does not show the loading view when the board is left and opened again', async () => {
    handlers.getUsersWithRuns = () => GROUP;
    renderGate('/board');
    await screen.findByText('board page, 2 runners');

    await userEvent.click(screen.getByRole('link', { name: 'to titles' }));
    await userEvent.click(screen.getByRole('link', { name: 'to board' }));

    expect(screen.getByText('board page, 2 runners')).toBeInTheDocument();
    expect(loadingView()).not.toBeInTheDocument();
  });

  it('does not show the loading view during a background refresh', async () => {
    handlers.getUsersWithRuns = () => GROUP;
    renderGate('/board');
    await screen.findByText('board page, 2 runners');

    const refreshed = deferred<typeof GROUP>();
    const refresh = vi.fn(() => refreshed.promise);
    handlers.getUsersWithRuns = refresh;
    await userEvent.click(screen.getByRole('button', { name: 'refresh in the background' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());

    expect(screen.getByText('board page, 2 runners')).toBeInTheDocument();
    expect(loadingView()).not.toBeInTheDocument();
    await act(async () => refreshed.resolve(GROUP));
    expect(loadingView()).not.toBeInTheDocument();
  });

  it('does not bring the loading view back when the cached standings are removed', async () => {
    handlers.getUsersWithRuns = () => GROUP;
    const client = newClient();
    renderGate('/board', client);
    await screen.findByText('board page, 2 runners');

    handlers.getUsersWithRuns = () => new Promise(() => {});
    await act(async () => {
      void client.resetQueries({ queryKey: USERS_WITH_RUNS_QUERY_KEY });
    });

    expect(loadingView()).not.toBeInTheDocument();
  });
});

describe('other pages on the first load', () => {
  it('open at once, without waiting for the standings', () => {
    handlers.getUsersWithRuns = () => new Promise(() => {});
    renderGate('/titles');

    expect(screen.getByText('titles page')).toBeInTheDocument();
    expect(loadingView()).not.toBeInTheDocument();
  });
});
