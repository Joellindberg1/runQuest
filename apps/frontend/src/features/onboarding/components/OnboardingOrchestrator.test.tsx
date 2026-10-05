import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { changelog } from '@/features/changelog/changelogData';
import { announcedNotes } from '@/features/changelog/changelogModel';
import { OnboardingOrchestrator } from './OnboardingOrchestrator';

vi.mock('@/shared/services/backendApi', () => ({ backendApi: { getToken: () => 'token', onUnauthorized: undefined } }));
vi.mock('./OnboardingTour', () => ({ OnboardingTour: () => <div data-testid="onboarding-tour" /> }));

// "What's new" läser changelog.json: en annonserad post → en popup, en gång per användare, sedd = slug i onboarding-tabellen.
const [announced] = announcedNotes(changelog.releases);
const ALL_TOURS = ['tour_leaderboard_v2', 'tour_titles_v2', 'tour_duels_v2', 'tour_events_v2', 'tour_profile_v2', 'tour_news_v1'];

let seen: string[] = [];
const markSeenCalls: string[] = [];
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (String(url).endsWith('/onboarding/mark-seen')) {
    const slug = JSON.parse(String(init?.body)).slug as string;
    markSeenCalls.push(slug);
    seen = [...seen, slug];
    return { ok: true, json: async () => ({}) } as Response;
  }
  return { ok: true, json: async () => ({ seen }) } as Response;
});

const renderOrchestrator = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <OnboardingOrchestrator />
  </QueryClientProvider>,
);

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  markSeenCalls.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

describe('onboarding-kön läser annonserade poster ur changelog.json', () => {
  it('slugen härleds ur versionen (patch_v2.0.0)', () => {
    expect(announced.slug).toBe('patch_v2.0.0');
  });

  it('en användare som gått förbi onboarding men inte sett posten får popupen med postens rubrik och punkter', async () => {
    seen = ['onboarding_v1'];
    renderOrchestrator();
    const dialog = await screen.findByRole('dialog', { name: announced.title }, { timeout: 3000 });
    const items = within(within(dialog).getByRole('list')).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(announced.changes.map((change) => change.description));
  });

  it('"Got it" sparar slugen som sedd och popupen försvinner (kön går vidare, ingen ny popup)', async () => {
    seen = ['onboarding_v1'];
    renderOrchestrator();
    fireEvent.click(await screen.findByRole('button', { name: 'Got it' }, { timeout: 3000 }));
    await waitFor(() => expect(markSeenCalls).toEqual(['patch_v2.0.0']));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('en användare som redan sett posten får ingen popup', async () => {
    seen = ['onboarding_v1', announced.slug, ...ALL_TOURS];
    renderOrchestrator();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('en ny användare får först touren, popupen efter den', async () => {
    seen = [];
    renderOrchestrator();
    expect(await screen.findByTestId('onboarding-tour')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
