import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FeatureTour } from './FeatureTour';

// RUN-155: FeatureTour märker <body> (data-rq-tour-pending) från aktiveringen tills touren är klar, så badge-popupen kan vänta in den. Markeringen får
// aldrig läcka: en tour som avmonteras (route-byte) före start, eller bredvid en annan tour, får inte lämna popupen blockerad för alltid.

vi.mock('@/features/onboarding/onboardingApi', () => ({
  fetchOnboardingStatus: async () => ['onboarding_v1'],
  markOnboardingSeen: async () => {},
}));
vi.mock('@/features/changelog/changelogData', () => ({ changelog: { releases: [] } }));
vi.mock('driver.js', () => ({ driver: () => ({ drive: () => {}, destroy: () => {} }) }));

const ATTR = 'data-rq-tour-pending';
const LONG_DELAY_MS = 60_000; // touren hinner aldrig starta: testerna gäller fönstret före driver.js
const steps = [{ title: 'Page', description: 'A page tour' }];
const pending = () => document.body.getAttribute(ATTR);

function Tours({ slugs }: { slugs: string[] }) {
  return <>{slugs.map((slug) => <FeatureTour key={slug} slug={slug} steps={steps} delayMs={LONG_DELAY_MS} />)}</>;
}

let client: QueryClient;
const wrap = (slugs: string[]) => (
  <QueryClientProvider client={client}><Tours slugs={slugs} /></QueryClientProvider>
);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: Infinity }, mutations: { retry: false } } });
  document.body.removeAttribute(ATTR);
});
afterEach(() => { document.body.removeAttribute(ATTR); });

describe('FeatureTour: data-rq-tour-pending läcker inte (RUN-155)', () => {
  it('sätts när touren aktiveras och försvinner när den avmonteras under fördröjningen (route-byte)', async () => {
    const { unmount } = render(wrap(['tour_a']));
    await waitFor(() => expect(pending()).toBe('1'));
    expect(document.body.classList.contains('driver-active')).toBe(false);

    unmount();
    expect(pending()).toBeNull();
  });

  it('sätts inte alls för en redan sedd tour', async () => {
    const { unmount } = render(wrap(['onboarding_v1']));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(pending()).toBeNull();
    unmount();
  });

  it('två samtidiga touren räknas var för sig: att den ena avmonteras nollar inte den andras markering', async () => {
    const { rerender, unmount } = render(wrap(['tour_a', 'tour_b']));
    await waitFor(() => expect(pending()).toBe('2'));

    rerender(wrap(['tour_b']));
    expect(pending()).toBe('1');

    unmount();
    expect(pending()).toBeNull();
  });
});
