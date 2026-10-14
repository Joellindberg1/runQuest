import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FeatureTour } from './FeatureTour';
import { OnboardingTour } from './OnboardingTour';

// Livscykeln runt driver.js (start, avmontering, resize, stängning). Riktiga driver.js; bara `drive` är inlindad så att testerna kan räkna starter.
const spies = vi.hoisted(() => ({ marked: [] as string[], drives: [] as Array<number | 'start'> }));
vi.mock('@/features/onboarding/onboardingApi', () => ({
  fetchOnboardingStatus: async () => ['onboarding_v1'],
  markOnboardingSeen: async (slug: string) => { spies.marked.push(slug); },
}));
vi.mock('@/features/changelog/changelogData', () => ({ changelog: { releases: [] } }));
vi.mock('driver.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('driver.js')>();
  return {
    ...actual,
    driver: (config: Parameters<typeof actual.driver>[0]) => {
      const instance = actual.driver(config);
      const drive = instance.drive;
      instance.drive = (index?: number) => {
        spies.drives.push(index ?? 'start');
        return drive(index);
      };
      return instance;
    },
  };
});

const SLOW = { timeout: 4000 }; // riktiga driver.js animerar med rAF: under full sviten kan en enskild väntan ta över findBy-sekunden
const START_MS = 5;
const SETTLE_MS = 400; // längre än resize-väntan i OnboardingTour (150 ms)
const RECT = { x: 10, y: 10, top: 10, left: 10, width: 100, height: 40, right: 110, bottom: 50, toJSON: () => ({}) };
const steps = [
  { title: 'Intro', description: 'First' },
  { element: '[data-tour="lifecycle"]', title: 'Anchored', description: 'Second' },
  { title: 'Last', description: 'Third' },
];

let client: QueryClient;
beforeEach(() => {
  spies.marked.length = 0;
  spies.drives.length = 0;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: Infinity }, mutations: { retry: false } } });
  // jsdom har ingen layout (se FeatureTour.test.tsx).
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(RECT);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(RECT.width);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(RECT.height);
  const anchor = document.createElement('section');
  anchor.setAttribute('data-tour', 'lifecycle');
  document.body.appendChild(anchor);
});
afterEach(() => {
  vi.restoreAllMocks();
  document.querySelectorAll('[data-tour="lifecycle"]').forEach((element) => element.remove());
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const dialogGone = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW);
const next = async (user: ReturnType<typeof userEvent.setup>) => user.click(await screen.findByRole('button', { name: /Next/ }, SLOW));
const mountFeatureTour = (slug: string, delayMs = START_MS) =>
  render(<QueryClientProvider client={client}><FeatureTour slug={slug} steps={steps} delayMs={delayMs} /></QueryClientProvider>);

describe('OnboardingTour: avmontering', () => {
  it('avmontering mitt i turen markerar den inte som sedd, men Esc gör det en gång', async () => {
    const user = userEvent.setup();
    const midTour = mountFeatureTour('tour_unmount');
    await screen.findByRole('dialog', { name: 'Intro' }, SLOW);
    midTour.unmount();
    await wait(200);
    expect(spies.marked).toEqual([]);

    mountFeatureTour('tour_unmount');
    await screen.findByRole('dialog', { name: 'Intro' }, SLOW);
    await user.keyboard('{Escape}');
    await dialogGone();
    await waitFor(() => expect(spies.marked).toEqual(['tour_unmount']), SLOW);
  });

  it('avmontering under startfördröjningen startar ingen tur', async () => {
    const view = mountFeatureTour('tour_early', 150);
    await wait(30);
    view.unmount();
    await wait(400);

    expect(spies.drives).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body).not.toHaveClass('driver-active');
    expect(spies.marked).toEqual([]);
  });

  it('en resize efter avmontering varken kastar eller startar om något', async () => {
    const view = mountFeatureTour('tour_resize_unmounted');
    await screen.findByRole('dialog', { name: 'Intro' }, SLOW);
    view.unmount();
    window.dispatchEvent(new Event('resize'));
    await wait(SETTLE_MS);

    expect(spies.drives).toEqual(['start']);
  });
});

describe('OnboardingTour: resize', () => {
  it('en resize startar inte om turen: varken på ett flytande steg, på ett oförändrat ankare eller efter Done', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<OnboardingTour steps={steps} onDone={onDone} delayMs={START_MS} />);
    await screen.findByRole('dialog', { name: 'Intro' }, SLOW);

    window.dispatchEvent(new Event('resize'));
    await wait(SETTLE_MS);
    expect(spies.drives).toEqual(['start']);

    await next(user);
    await screen.findByRole('dialog', { name: 'Anchored' }, SLOW);
    window.dispatchEvent(new Event('resize'));
    await wait(SETTLE_MS);
    expect(spies.drives).toEqual(['start']);

    await next(user);
    await screen.findByRole('dialog', { name: 'Last' }, SLOW);
    await user.click(await screen.findByRole('button', { name: 'Done' }, SLOW));
    await dialogGone();
    expect(onDone).toHaveBeenCalledTimes(1);

    // Stängd men fortfarande monterad: en resize får inte väcka turen igen.
    window.dispatchEvent(new Event('resize'));
    await wait(SETTLE_MS);
    expect(spies.drives).toEqual(['start']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('en resize efter Esc, med turen kvar monterad, startar inte om den', async () => {
    const user = userEvent.setup();
    render(<OnboardingTour steps={steps} onDone={() => {}} delayMs={START_MS} />);
    await screen.findByRole('dialog', { name: 'Intro' }, SLOW);
    await user.keyboard('{Escape}');
    await dialogGone();

    window.dispatchEvent(new Event('resize'));
    await wait(SETTLE_MS);

    expect(spies.drives).toEqual(['start']);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body).not.toHaveClass('driver-active');
  });

  it('ett borttaget ankare plus många resizar ger en omstart, ingen loop', async () => {
    const user = userEvent.setup();
    render(<OnboardingTour steps={steps} onDone={() => {}} delayMs={START_MS} />);
    await screen.findByRole('dialog', { name: 'Intro' }, SLOW);
    await next(user);
    await screen.findByRole('dialog', { name: 'Anchored' }, SLOW);

    document.querySelector('[data-tour="lifecycle"]')?.remove();
    for (let i = 0; i < 10; i += 1) {
      window.dispatchEvent(new Event('resize'));
      await wait(10);
    }
    await wait(SETTLE_MS + 100);
    expect(spies.drives).toEqual(['start', 1]);

    window.dispatchEvent(new Event('resize'));
    await wait(SETTLE_MS);
    expect(spies.drives).toEqual(['start', 1]);
    expect(await screen.findByRole('dialog', { name: 'Anchored' }, SLOW)).toBeInTheDocument();
  });
});
