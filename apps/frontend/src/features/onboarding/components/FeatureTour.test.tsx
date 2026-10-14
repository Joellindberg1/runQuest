import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FeatureTour } from './FeatureTour';

// RUN-155: FeatureTour märker <body> (data-rq-tour-pending) från aktiveringen tills touren är klar, så badge-popupen kan vänta in den. Markeringen får
// aldrig läcka: en tour som avmonteras (route-byte) före start, eller bredvid en annan tour, får inte lämna popupen blockerad för alltid.

vi.mock('@/features/onboarding/onboardingApi', () => ({
  fetchOnboardingStatus: async () => ['onboarding_v1'],
  markOnboardingSeen: async () => {},
}));
vi.mock('@/features/changelog/changelogData', () => ({ changelog: { releases: [] } }));

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

describe('FeatureTour: data-rq-tour-pending läcker inte', () => {
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

// Riktiga driver.js: Esc, fokus och ankarbyte är driver.js:s eget beteende, så en mock skulle bara testa mocken.
describe('FeatureTour: tangentbord och fokus', () => {
  const START_MS = 5;
  const RECT = { x: 10, y: 10, top: 10, left: 10, width: 100, height: 40, right: 110, bottom: 50, toJSON: () => ({}) };

  // jsdom har ingen layout: driver.js hoppar över element utan storlek när det väljer vad som får fokus, och OnboardingTour gör ankare utan storlek flytande.
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(RECT);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(RECT.width);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(RECT.height);
  });
  afterEach(() => vi.restoreAllMocks());

  const tourSteps = [
    { title: 'Intro', description: 'First step' },
    { title: 'Second', description: 'Second step' },
    { title: 'Last', description: 'Last step' },
  ];

  function Page() {
    return (
      <>
        <button type="button">Before the tour</button>
        <FeatureTour slug="tour_keys" steps={tourSteps} delayMs={START_MS} />
      </>
    );
  }

  const renderPage = () => render(<QueryClientProvider client={client}><Page /></QueryClientProvider>);
  const trigger = () => screen.getByRole('button', { name: 'Before the tour' });

  it('turen går att stänga med Esc och fokus återgår', async () => {
    const user = userEvent.setup();
    renderPage();

    // Mitt i turen (efter Next) är det svåra fallet: driver.js minns då popoverns egen knapp, som är borta när touren stängs.
    trigger().focus();
    expect(await screen.findByRole('dialog', { name: 'Intro' })).toBeInTheDocument();
    expect(trigger()).not.toHaveFocus();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(await screen.findByRole('dialog', { name: 'Second' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger()).toHaveFocus();
    expect(pending()).toBeNull();
  });

  it('Esc på första steget stänger turen och fokus återgår', async () => {
    const user = userEvent.setup();
    renderPage();

    trigger().focus();
    await screen.findByRole('dialog', { name: 'Intro' });
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger()).toHaveFocus();
  });

  it('ett klick under startfördröjningen räknas: fokus återgår till det senast fokuserade elementet, inte det som hade fokus vid aktiveringen', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <button type="button">Early</button>
        <button type="button">Late</button>
        <FeatureTour slug="tour_keys" steps={tourSteps} delayMs={150} />
      </QueryClientProvider>,
    );
    screen.getByRole('button', { name: 'Early' }).focus();
    await waitFor(() => expect(pending()).toBe('1'));
    screen.getByRole('button', { name: 'Late' }).focus();

    await screen.findByRole('dialog', { name: 'Intro' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Late' })).toHaveFocus();
  });

  // /news byter ankaret news-settings vid 1024 px (kortet i kolumnen ↔ kugghjulsknappen). Stegen byggs en gång, men driver.js slår upp
  // selektorn först när steget visas: bytet mellan stegen ger rätt element, och bytet MEDAN steget visas kraschar inte (markeringen ligger
  // kvar på det gamla elementet tills man bläddrar vidare).
  it('turen klarar att ankaret byts ut mitt i turen (brytpunkten korsas)', async () => {
    const user = userEvent.setup();
    const anchor = (tag: 'section' | 'button') => {
      const element = document.createElement(tag);
      element.setAttribute('data-tour', 'swap');
      document.body.appendChild(element);
      return element;
    };
    const card = anchor('section');
    render(
      <QueryClientProvider client={client}>
        <FeatureTour slug="tour_swap" steps={[{ title: 'Intro', description: 'First' }, { element: '[data-tour="swap"]', title: 'Settings', description: 'Anchored' }, { title: 'End', description: 'Last' }]} delayMs={START_MS} />
      </QueryClientProvider>,
    );

    await screen.findByRole('dialog', { name: 'Intro' });
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await screen.findByRole('dialog', { name: 'Settings' });
    expect(card).toHaveClass('driver-active-element');

    // Brytpunkten korsas medan steget visas.
    card.remove();
    const gear = anchor('button');
    window.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

    // Bläddrar man bort och tillbaka hittar driver.js det nya ankaret.
    await user.click(screen.getByRole('button', { name: /Back/ }));
    await screen.findByRole('dialog', { name: 'Intro' });
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await screen.findByRole('dialog', { name: 'Settings' });
    expect(gear).toHaveClass('driver-active-element');

    // Och turen går att avsluta som vanligt.
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await screen.findByRole('dialog', { name: 'End' });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pending()).toBeNull();
    gear.remove();
  });

  it('en tour utan förhandsfokus (sidan nyladdad) stängs med Esc utan att kasta', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('dialog', { name: 'Intro' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pending()).toBeNull();
  });
});
