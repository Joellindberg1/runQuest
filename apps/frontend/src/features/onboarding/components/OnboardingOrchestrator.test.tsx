import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChangelogData } from '@/features/changelog/changelogTypes';
import { FeatureTour } from './FeatureTour';
import { OnboardingOrchestrator } from './OnboardingOrchestrator';

// Egen fixtur i stället för den riktiga changelog.json: testerna ska inte gå sönder när nästa release läggs in.
const FIXTURE = vi.hoisted((): ChangelogData => ({
  features: [],
  workingOn: [],
  releases: [
    { version: '9.2.0', type: 'minor', date: '1 January 2030', title: 'Quiet release', changes: [{ type: 'improvement', description: 'Not announced.' }] },
    {
      version: '9.1.0', type: 'minor', date: '1 January 2030', title: 'Big news', announce: true,
      changes: [{ type: 'feature', description: 'First thing.' }, { type: 'bugfix', description: 'Second thing.' }],
    },
  ],
}));
vi.mock('@/features/changelog/changelogData', () => ({ changelog: FIXTURE }));
vi.mock('@/shared/services/backendApi', () => ({ backendApi: { getToken: () => 'token', onUnauthorized: undefined } }));
vi.mock('./OnboardingTour', () => ({
  OnboardingTour: ({ steps, onDone }: { steps: unknown[]; onDone: () => void }) => (
    <div data-testid="onboarding-tour" data-steps={steps.length}><button onClick={onDone}>Finish tour</button></div>
  ),
}));

const SLUG = 'patch_v9.1.0';
const ALL_TOURS = ['tour_leaderboard_v2', 'tour_titles_v2', 'tour_duels_v2', 'tour_events_v2', 'tour_profile_v2', 'tour_news_v1'];
const PAGE_TOUR_STEPS = [{ title: 'Page tour', description: 'Page tour step' }];
const WAIT = { timeout: 3000 };

let seen: string[] = [];
let failMarkSeen = false;
const markSeenCalls: string[] = [];
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (String(url).endsWith('/onboarding/mark-seen')) {
    const slug = JSON.parse(String(init?.body)).slug as string;
    markSeenCalls.push(slug);
    if (failMarkSeen) return { ok: false, status: 500, json: async () => ({}) } as Response;
    seen = [...seen, slug];
    return { ok: true, json: async () => ({}) } as Response;
  }
  return { ok: true, json: async () => ({ seen }) } as Response;
});

const renderQueue = (withPageTour = false) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <OnboardingOrchestrator />
    {withPageTour && <FeatureTour slug="tour_news_v1" steps={PAGE_TOUR_STEPS} />}
  </QueryClientProvider>,
);
const pageTour = () => screen.queryAllByTestId('onboarding-tour').find((tour) => tour.getAttribute('data-steps') === String(PAGE_TOUR_STEPS.length));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  markSeenCalls.length = 0;
  failMarkSeen = false;
});
afterEach(() => vi.unstubAllGlobals());

describe('onboarding-kön läser annonserade poster ur changelog.json', () => {
  it('en användare som gått förbi onboarding men inte sett posten får popupen med postens rubrik och punkter — bara den annonserade posten', async () => {
    seen = ['onboarding_v1'];
    renderQueue();
    const dialog = await screen.findByRole('dialog', { name: 'Big news' }, WAIT);
    const items = within(within(dialog).getByRole('list')).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['First thing.', 'Second thing.']);
    expect(screen.queryByText('Quiet release')).toBeNull();
  });

  it('"Got it" sparar slugen (härledd ur versionen) och popupen försvinner', async () => {
    seen = ['onboarding_v1'];
    renderQueue();
    fireEvent.click(await screen.findByRole('button', { name: 'Got it' }, WAIT));
    await waitFor(() => expect(markSeenCalls).toEqual([SLUG]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('dubbelklick på "Got it" sparar bara en gång', async () => {
    seen = ['onboarding_v1'];
    renderQueue();
    const button = await screen.findByRole('button', { name: 'Got it' }, WAIT);
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(markSeenCalls).toEqual([SLUG]);
  });

  it('misslyckas sparningen stängs popupen ändå och kön går vidare (posten visas igen nästa gång)', async () => {
    seen = ['onboarding_v1'];
    failMarkSeen = true;
    renderQueue(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Got it' }, WAIT));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(markSeenCalls).toEqual([SLUG]));
    // kön är inte blockerad: sidans tour får starta
    await waitFor(() => expect(pageTour()).toBeDefined());
    // servern sparade inget → ingen sett-lista att läsa ur
    expect(seen).not.toContain(SLUG);
  });

  it('en användare som redan sett posten får ingen popup', async () => {
    seen = ['onboarding_v1', SLUG, ...ALL_TOURS];
    renderQueue();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('en ny användare får först touren; popupen kommer EFTER den, när touren är klar', async () => {
    seen = [];
    renderQueue();
    expect(await screen.findByTestId('onboarding-tour')).toBeInTheDocument();
    // väntar längre än popupens egen fördröjning: den får inte visas före touren
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Finish tour' }));
    expect(await screen.findByRole('dialog', { name: 'Big news' }, WAIT)).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-tour')).toBeNull();
  });
});

describe('sidornas feature tours väntar på annonserade poster', () => {
  it('en FeatureTour startar inte medan popupen väntar (patch_-posten är osedd), men direkt efter att den kvitterats', async () => {
    seen = ['onboarding_v1'];
    renderQueue(true);
    await screen.findByRole('dialog', { name: 'Big news' }, WAIT);
    expect(pageTour()).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(pageTour()).toBeDefined());
  });

  it('utan osedd post startar sidans tour på en gång', async () => {
    seen = ['onboarding_v1', SLUG];
    renderQueue(true);
    await waitFor(() => expect(pageTour()).toBeDefined());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
