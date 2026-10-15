import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LogPage from './LogPage';
import { AppShell } from '@/app-shell/AppShell';
import { AuthContext, type AuthContextType } from '@/providers/authContext';
import { ME, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { setViewportWidth } from '@/test/viewport';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));

// Skarven skalets "Right now" ↔ Log-skärmens Strava-rad med EN delad QueryClient: båda läser ['strava','status'] genom samma hook; synken
// ['strava','last-sync'] läses bara av Log-raden (skalet visar ingen nästa synk). Hooks i shared/hooks/useStravaQueries.

const MS_MINUTE = 60_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

function renderShell(entry: string) {
  setViewportWidth(390);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  const auth: AuthContextType = {
    user: { id: ME.id, name: ME.name, email: 'joel@example.com', is_admin: false },
    login: async () => ({ success: true }), logout: () => {}, loading: false, isAdmin: false,
  };
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/log" element={<LogPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

let statusCalls = 0;
let syncCalls = 0;

beforeEach(() => {
  resetFakeBackend();
  statusCalls = 0;
  syncCalls = 0;
  handlers.getStravaStatus = () => {
    statusCalls += 1;
    return { success: true, data: { connected: true, expired: false, last_import_at: at(-32 * MS_MINUTE) } };
  };
  handlers.getStravaLastSync = () => {
    syncCalls += 1;
    return { success: true, data: { last_sync_attempt: at(-32 * MS_MINUTE), last_sync_status: 'ok', next_sync_estimated: at(28 * MS_MINUTE) } };
  };
});

describe('Skalets Right now ↔ Log delar Strava-cachen', () => {
  it('skalet och Log-raden delar status-queryn (en hämtning), Log-raden hämtar inte last-sync, och ingen nästa synk visas', async () => {
    const { container } = renderShell('/log');

    expect(await screen.findByText('Strava connected')).toBeInTheDocument();
    expect(await screen.findByText(/^Last import (31|32|33) min ago$/)).toBeInTheDocument();
    // En kopplad Strava ger ingen pill i skalet.
    expect(container.querySelector('[data-tour="right-now-strava"]')).toBeNull();
    expect(statusCalls).toBe(1);
    expect(syncCalls).toBe(0);
  });
});
