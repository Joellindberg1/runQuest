import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { EventItem } from '@runquest/shared';
import EventsPage from './EventsPage';
import { AppShell } from '@/app-shell/AppShell';
import { event, mine } from '@/features/events/events.fixture';
import { AuthContext, type AuthContextType } from '@/providers/authContext';
import { ME, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { LocationProbe } from '@/test/LocationProbe';
import { setViewportWidth } from '@/test/viewport';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));

// Skarven skalets "Right now" ↔ Events-skärmen med EN delad QueryClient och EN handler (getEventList). Båda läser
// query-nyckeln ['events'] — via samma hook — och måste cacha samma dataform.

const MS_HOUR = 3_600_000;
const MS_MINUTE = 60_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

const TEMPLATE = { icon: 'calendar', description: 'Run 5 km before midnight', minKm: 5, rewardXp: 25, rewardXp1st: 0, rewardXp2nd: 0, rewardXp3rd: 0, requiresWeather: null };

const open = (id: string, name: string, over: Partial<EventItem> = {}) =>
  event({ id, startsAt: at(-2 * MS_HOUR), endsAt: at(3 * MS_HOUR + 30_000), template: { name, ...TEMPLATE }, participantCount: 2, ...over });

// Som renderWithApp, men med DEFAULT gcTime (renderWithApp har 0, så en query raderas när sidan som läste den avmonteras) och
// med klienten utlämnad så att testet kan tvinga fram en ny hämtning.
function renderShell(entry: string, width = 390) {
  setViewportWidth(width);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const auth: AuthContextType = {
    user: { id: ME.id, name: ME.name, email: 'joel@example.com', is_admin: false },
    login: async () => ({ success: true }), logout: () => {}, loading: false, isAdmin: false,
  };
  const ui: ReactNode = (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/board" element={<div>board page</div>} />
              <Route path="/events" element={<EventsPage />} />
            </Route>
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
  return { queryClient, ...render(ui) };
}

const rightNow = async () => within(await screen.findByRole('list', { name: 'Right now' }));

beforeEach(() => {
  resetFakeBackend();
  handlers.getStravaStatus = () => ({ success: true, data: { connected: true, expired: false } });
  handlers.getStravaLastSync = () => ({
    success: true,
    data: { last_sync_attempt: null, last_sync_status: 'ok', next_sync_estimated: at(20 * MS_MINUTE) },
  });
});

describe('Skalets Right now ↔ Events delar events-cachen', () => {
  it('skalet hämtar, Events-sidan ritar ur samma cache (en handler, ett anrop) och båda visar eventet', async () => {
    let calls = 0;
    handlers.getEventList = () => {
      calls += 1;
      return { success: true, data: { events: [open('e1', 'Evening run')] } };
    };
    renderShell('/board');

    expect((await rightNow()).getByText('Evening run')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Events' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/events'));

    expect(await screen.findByRole('heading', { name: 'Evening run', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('2 of 6 done')).toBeInTheDocument();
    expect(calls).toBe(1); // färsk cache → ingen omhämtning vid sidbytet
  });

  it('omvänt: Events först, sedan skalets pill ur samma cache', async () => {
    handlers.getEventList = () => ({ success: true, data: { events: [open('e1', 'Evening run')] } });
    renderShell('/events');
    expect(await screen.findByRole('heading', { name: 'Evening run', level: 2 })).toBeInTheDocument();
    expect((await rightNow()).getByText('Evening run')).toBeInTheDocument();
  });
});

describe('Skalet och skärmen säger samma sak under cron-släpet (klockan avgör, inte status)', () => {
  it('ett startat event som backend ännu kallar "scheduled" är öppet i båda: kalenderprick, pill och öppet-kort', async () => {
    handlers.getEventList = () => ({
      success: true,
      data: { events: [open('e1', 'Evening run', { status: 'scheduled' })] },
    });
    renderShell('/events');
    expect(await screen.findByRole('img', { name: 'Event open now' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Open now and up next' })).getByText('Open now')).toBeInTheDocument();
    expect((await rightNow()).getByText('3h')).toBeInTheDocument(); // "slutar om", inte "in 0 m"
  });

  const notEnteredCompetition = () => {
    handlers.getEventList = () => ({
      success: true,
      data: {
        events: [event({
          id: 'c1', type: 'competition', metric: 'km', startsAt: at(-2 * MS_HOUR), endsAt: at(3 * 24 * MS_HOUR + 30_000),
          template: { name: 'Weekly km', ...TEMPLATE, description: 'Most kilometres in the week', rewardXp1st: 100 },
          myEntry: null, leaderboard: [], participantCount: 0,
        })],
      },
    });
  };

  it('en pågående tävling jag inte är med i än: pill, kalenderprick och öppet-kort i båda (samma regel)', async () => {
    notEnteredCompetition();
    renderShell('/events');
    expect(await screen.findByRole('img', { name: 'Event open now' })).toBeInTheDocument();
    const region = within(screen.getByRole('region', { name: 'Open now and up next' }));
    expect(region.getByText('Open now')).toBeInTheDocument();
    expect(region.getByText(/You are not on the board yet/)).toBeInTheDocument();
    const pills = await rightNow();
    expect(pills.getByText('Weekly km')).toBeInTheDocument();
  });

  it('desktop: samma tävling i Right now-panelen med noteringen "Not entered"', async () => {
    notEnteredCompetition();
    renderShell('/events', 1280);
    expect(await screen.findByText(/You are not on the board yet/)).toBeInTheDocument();
    const panel = within(await screen.findByRole('region', { name: 'Right now' }));
    expect(panel.getByText('Weekly km')).toBeInTheDocument();
    expect(panel.getByText('Not entered')).toBeInTheDocument();
  });

  it('ett participation-event som passerat sitt slut (men inte hunnit avräknas) saknas i båda', async () => {
    handlers.getEventList = () => ({
      success: true,
      data: { events: [open('e1', 'Evening run', { endsAt: at(-MS_MINUTE) })] },
    });
    renderShell('/events');
    expect(await screen.findByText(/Nothing is open or scheduled right now/)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Event open now' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Evening run' })).toBeNull();
    expect(screen.queryByText('Evening run')).toBeNull(); // inte heller som Right now-pill
  });
});

describe('Avräknade event: historik och facit hämtas om', () => {
  it('tappar öppet-listan ett event invalideras historiken, så resultatet syns utan att vänta på staleTime', async () => {
    const historyCalls: Array<[unknown, unknown]> = [];
    let settled = false;
    handlers.getEventList = () => ({
      success: true,
      data: { events: settled ? [] : [open('e1', 'Evening run', { myEntry: mine({ xpAwarded: 25 }) })] },
    });
    handlers.getEventHistoryPage = (limit: unknown, offset: unknown) => {
      historyCalls.push([limit, offset]);
      const events = settled && limit === 6
        ? [event({ id: 'h1', status: 'settled', template: { name: 'Evening run', ...TEMPLATE }, myEntry: mine({ xpAwarded: 25 }), startsAt: '2026-10-02T16:00:00Z', endsAt: '2026-10-02T20:00:00Z' })]
        : [];
      return { success: true, data: { events, meta: { total: events.length, limit, offset, has_more: false } } };
    };
    const { queryClient } = renderShell('/events');
    await screen.findByRole('heading', { name: 'Evening run', level: 2 });
    await screen.findByText('No event has finished yet.');
    const before = historyCalls.length;

    settled = true; // cron har avräknat eventet
    await queryClient.refetchQueries({ queryKey: ['events'], exact: true });

    await waitFor(() => expect(historyCalls.length).toBeGreaterThan(before));
    expect(await screen.findByText(/2 Oct/)).toBeInTheDocument();
    expect(screen.queryByText('No event has finished yet.')).toBeNull();
  });

  it('en hämtning där inget event försvunnit rör inte historiken', async () => {
    let historyCalls = 0;
    handlers.getEventList = () => ({ success: true, data: { events: [open('e1', 'Evening run')] } });
    handlers.getEventHistoryPage = (limit: unknown, offset: unknown) => {
      historyCalls += 1;
      return { success: true, data: { events: [], meta: { total: 0, limit, offset, has_more: false } } };
    };
    const { queryClient } = renderShell('/events');
    await screen.findByText('No event has finished yet.');
    const before = historyCalls;
    await queryClient.refetchQueries({ queryKey: ['events'], exact: true });
    expect(historyCalls).toBe(before);
  });
});
