import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { FirstBoardGate, FIRST_BOARD_DATA_MAX_WAIT_MS } from './FirstBoardGate';
import { USERS_WITH_RUNS_QUERY_KEY, useUsersWithRuns } from '@/shared/hooks/useUsersWithRuns';
import { ME, OTHER, handlers, resetFakeBackend } from '@/test/fakeBackend';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);

// Gaten sitter över skalet i routeträdet. Sidorna här är minimala: gaten ska hålla undan hela trädet under den, inte bara en viss sida.
function BoardStub() {
  const query = useUsersWithRuns(true);
  const queryClient = useQueryClient();
  return (
    <main>
      <p>board page, {query.data ? `${query.data.length} runners` : 'no data yet'}</p>
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

function renderGate(entry: string, client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route element={<FirstBoardGate />}>
            <Route path="/board" element={<BoardStub />} />
            <Route path="/titles" element={<TitlesStub />} />
          </Route>
        </Routes>
      </MemoryRouter>
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

beforeEach(() => {
  resetFakeBackend();
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

  it('replaces the loading view with the page when the first fetch fails, so it is never endless', async () => {
    handlers.getUsersWithRuns = () => ({ success: false, error: 'boom' });
    renderGate('/board');

    expect(await screen.findByText('board page, no data yet')).toBeInTheDocument();
    expect(loadingView()).not.toBeInTheDocument();
  });

  it('replaces the loading view with the page at the first failed attempt, without waiting for the retries', async () => {
    // Omförsöken pågår (nästa om en minut). Skulle gaten vänta på dem och sedan släppa, startar Boards nya observatörer om hämtningen och felvyn dröjer dubbelt.
    handlers.getUsersWithRuns = () => ({ success: false, error: 'boom' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 60_000, gcTime: Infinity } } });
    renderGate('/board', client);

    expect(await screen.findByText('board page, no data yet')).toBeInTheDocument();
    expect(loadingView()).not.toBeInTheDocument();
    client.clear();
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

  it('does not show the loading view when the standings are already in the cache', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    client.setQueryData(USERS_WITH_RUNS_QUERY_KEY, [ME]);
    handlers.getUsersWithRuns = () => new Promise(() => {});
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
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
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
