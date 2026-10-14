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
const SLOW = { timeout: 4000 }; // riktiga driver.js animerar med rAF: under full sviten kan en enskild väntan ta över findBy-sekunden
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
    expect(await screen.findByRole('dialog', { name: 'Intro' }, SLOW)).toBeInTheDocument();
    expect(trigger()).not.toHaveFocus();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(await screen.findByRole('dialog', { name: 'Second' }, SLOW)).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW);
    expect(trigger()).toHaveFocus();
    expect(pending()).toBeNull();
  });

  it('Esc på första steget stänger turen och fokus återgår', async () => {
    const user = userEvent.setup();
    renderPage();

    trigger().focus();
    await screen.findByRole('dialog', { name: 'Intro' }, SLOW);
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW);
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

    await screen.findByRole('dialog', { name: 'Intro' }, SLOW);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW);
    expect(screen.getByRole('button', { name: 'Late' })).toHaveFocus();
  });

  // /news byter ankaret news-settings vid 1024 px (kortet i kolumnen ↔ kugghjulsknappen). driver.js slår upp selektorn bara när ett steg
  // börjar, så OnboardingTour visar om steget mot det nya elementet när det gamla har lämnat DOM:en vid en resize.
  describe('ankarbyte vid brytpunkten', () => {
    const anchor = (tag: 'section' | 'button') => {
      const element = document.createElement(tag);
      element.setAttribute('data-tour', 'swap');
      document.body.appendChild(element);
      return element;
    };
    const swapSteps = [
      { title: 'Intro', description: 'First' },
      { element: '[data-tour="swap"]', title: 'Settings', description: 'Anchored' },
      { title: 'End', description: 'Last' },
    ];
    afterEach(() => document.querySelectorAll('[data-tour="swap"]').forEach((element) => element.remove()));

    it('markeringen följer det nya ankaret när det gamla har bytts ut medan steget visas', async () => {
      const user = userEvent.setup();
      const card = anchor('section');
      render(<QueryClientProvider client={client}><FeatureTour slug="tour_swap" steps={swapSteps} delayMs={START_MS} /></QueryClientProvider>);

      await screen.findByRole('dialog', { name: 'Intro' }, SLOW);
      await user.click(screen.getByRole('button', { name: /Next/ }));
      await screen.findByRole('dialog', { name: 'Settings' }, SLOW);
      expect(card).toHaveClass('driver-active-element');

      // Brytpunkten korsas medan steget visas.
      card.remove();
      const gear = anchor('button');
      window.dispatchEvent(new Event('resize'));

      await waitFor(() => expect(gear).toHaveClass('driver-active-element'), SLOW);
      expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

      // Och turen går att avsluta som vanligt.
      await user.click(screen.getByRole('button', { name: /Next/ }));
      await screen.findByRole('dialog', { name: 'End' }, SLOW);
      await user.click(screen.getByRole('button', { name: 'Done' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW);
      expect(pending()).toBeNull();
    });

    it('en resize utan ankarbyte visar inte om steget', async () => {
      const user = userEvent.setup();
      const card = anchor('section');
      render(<QueryClientProvider client={client}><FeatureTour slug="tour_swap" steps={swapSteps} delayMs={START_MS} /></QueryClientProvider>);
      await screen.findByRole('dialog', { name: 'Intro' }, SLOW);
      await user.click(screen.getByRole('button', { name: /Next/ }));
      await screen.findByRole('dialog', { name: 'Settings' }, SLOW);

      const closeButton = screen.getByRole('button', { name: 'Close' });
      closeButton.focus();
      window.dispatchEvent(new Event('resize'));
      await new Promise((resolve) => setTimeout(resolve, 400));

      // Ett omstartat steg hade flyttat fokus in i popovern på nytt; här står det kvar och ankaret är orört.
      expect(card).toHaveClass('driver-active-element');
      expect(closeButton).toHaveFocus();
    });
  });

  it('avmonteras sidan mitt i turen (Back, route-byte) försvinner dialogen och driver-active', async () => {
    const { unmount } = renderPage();
    await screen.findByRole('dialog', { name: 'Intro' }, SLOW);
    expect(document.body).toHaveClass('driver-active');

    unmount();

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body).not.toHaveClass('driver-active');
    expect(pending()).toBeNull();
  });

  describe('focusin-lyssnaren som minns fokuset före turen', () => {
    // Antal document-lyssnare på focusin som lagts till respektive tagits bort sedan spionerna sattes.
    function spyOnFocusin() {
      const add = vi.spyOn(document, 'addEventListener');
      const remove = vi.spyOn(document, 'removeEventListener');
      const count = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === 'focusin').length;
      return { added: () => count(add), removed: () => count(remove) };
    }

    it('är balanserad efter Esc', async () => {
      const user = userEvent.setup();
      const listeners = spyOnFocusin();
      renderPage();
      await screen.findByRole('dialog', { name: 'Intro' }, SLOW);
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW);
      expect(listeners.added()).toBeGreaterThan(0);
      expect(listeners.removed()).toBe(listeners.added());
    });

    it('är balanserad efter Done', async () => {
      const user = userEvent.setup();
      const listeners = spyOnFocusin();
      renderPage();
      await screen.findByRole('dialog', { name: 'Intro' }, SLOW);
      await user.click(screen.getByRole('button', { name: /Next/ }));
      await screen.findByRole('dialog', { name: 'Second' }, SLOW);
      await user.click(screen.getByRole('button', { name: /Next/ }));
      await screen.findByRole('dialog', { name: 'Last' }, SLOW);
      await user.click(screen.getByRole('button', { name: 'Done' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW);
      expect(listeners.added()).toBeGreaterThan(0);
      expect(listeners.removed()).toBe(listeners.added());
    });

    it('är balanserad när sidan avmonteras innan turen startat', async () => {
      const listeners = spyOnFocusin();
      const { unmount } = render(<QueryClientProvider client={client}><FeatureTour slug="tour_keys" steps={tourSteps} delayMs={LONG_DELAY_MS} /></QueryClientProvider>);
      await waitFor(() => expect(pending()).toBe('1'));
      unmount();
      expect(listeners.added()).toBeGreaterThan(0);
      expect(listeners.removed()).toBe(listeners.added());
    });

    it('är balanserad när sidan avmonteras mitt i turen', async () => {
      const listeners = spyOnFocusin();
      const { unmount } = renderPage();
      await screen.findByRole('dialog', { name: 'Intro' }, SLOW);
      unmount();
      expect(listeners.added()).toBeGreaterThan(0);
      expect(listeners.removed()).toBe(listeners.added());
    });
  });

  it('en tour utan förhandsfokus (sidan nyladdad) stängs med Esc utan att kasta', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('dialog', { name: 'Intro' }, SLOW);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW);
    expect(pending()).toBeNull();
  });
});
