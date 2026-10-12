import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AppRoutes } from './routes';
import { ME, OTHER, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import { warmLanding } from '@/test/warmLazy';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
// Turerna startar driver.js efter en timer; de har egna tester och stör inte routingen.
// RunnerCard kastar på begäran, för att prova felgränsen runt desktop-overlayn.
const crash = vi.hoisted(() => ({ runnerCard: false }));
vi.mock('@/features/runner/components/RunnerCard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/runner/components/RunnerCard')>();
  return {
    ...actual,
    RunnerCard: (props: Parameters<typeof actual.RunnerCard>[0]) => {
      if (crash.runnerCard) throw new Error('runner card exploded');
      return actual.RunnerCard(props);
    },
  };
});
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));

const MOBILE = 390;
const DESKTOP = 1280;

const location = () => screen.getByTestId('location').textContent;

beforeEach(() => {
  resetFakeBackend();
});

beforeAll(warmLanding);

describe('varje route renderar utan krasch inne i skalet', () => {
  it.each([
    '/board', '/titles', '/duels', '/events', '/news', '/log', '/profile', '/badges',
    '/runner/u-karl', '/playbook', '/settings', '/features',
  ])('%s', async (path) => {
    const { container } = renderWithApp(<AppRoutes />, { entry: path, width: MOBILE });

    await waitFor(() => expect(container.querySelector('[data-shell="mobile"]')).not.toBeNull());
    await waitFor(() => expect(container.querySelector('main')?.textContent?.length).toBeGreaterThan(0));
    expect(location()).toBe(path);
  });

  it('/admin renderar för admin', async () => {
    const { container } = renderWithApp(<AppRoutes />, { entry: '/admin', admin: true, width: MOBILE });

    await waitFor(() => expect(container.querySelector('main')?.textContent?.length).toBeGreaterThan(0));
    expect(location()).toBe('/admin');
  });

  it('samma routes renderar i desktopskalet', async () => {
    const { container } = renderWithApp(<AppRoutes />, { entry: '/board', width: DESKTOP });
    await waitFor(() => expect(container.querySelector('[data-shell="desktop"]')).not.toBeNull());
  });

  it('/news är Pack News-skärmen: tomt läge med knapp till Log a run när gruppen inte gjort något än', async () => {
    renderWithApp(<AppRoutes />, { entry: '/news', width: MOBILE });

    expect(await screen.findByRole('heading', { name: 'Pack News', level: 1 })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'No news yet — go make some' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Log a run' }));
    await waitFor(() => expect(location()).toBe('/log'));
  });

  it('/badges renderar BadgesPage inne i skalet: rubriken, bottenbarens You-flik och (desktop) sidonavsraden är aktiva', async () => {
    const mobile = renderWithApp(<AppRoutes />, { entry: '/badges', width: MOBILE });
    expect(await screen.findByRole('heading', { level: 1, name: 'Badges' })).toBeInTheDocument();
    expect(mobile.container.querySelector('[data-shell="mobile"]')).not.toBeNull();
    expect(mobile.container.querySelector('.rq-tabbar [aria-current="page"]')).toHaveTextContent('You');
    mobile.unmount();

    const desktop = renderWithApp(<AppRoutes />, { entry: '/badges', width: DESKTOP });
    expect(await screen.findByRole('heading', { level: 1, name: 'Badges' })).toBeInTheDocument();
    expect(desktop.container.querySelector('[data-shell="desktop"]')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Badges' })).toHaveAttribute('aria-current', 'page');
  });

  it('/board visar The Standings med gruppens löpare (Season-vyn är default)', async () => {
    renderWithApp(<AppRoutes />, { entry: '/board', width: MOBILE });
    expect((await screen.findAllByText(OTHER.name)).length).toBeGreaterThan(0);
  });
});

describe('redirects (ADR 006 beslut 7) — gamla länkar 404:ar aldrig', () => {
  it.each([
    ['/', '/board'],
    ['/?tab=leaderboard', '/board'],
    ['/?tab=titles', '/titles'],
    ['/?tab=profile', '/profile'],
    ['/?tab=log-run', '/log'],
    ['/?tab=okänd', '/board'],
    ['/?tab=titles&utm=mail', '/titles?utm=mail'],
    ['/challenges', '/duels'],
    ['/challenges?x=1', '/duels?x=1'],
  ])('%s → %s', async (from, to) => {
    renderWithApp(<AppRoutes />, { entry: from, width: MOBILE });
    await waitFor(() => expect(location()).toBe(to));
  });

  it('/runner/<eget id> → /profile', async () => {
    renderWithApp(<AppRoutes />, { entry: `/runner/${ME.id}`, width: MOBILE });
    await waitFor(() => expect(location()).toBe('/profile'));
  });

  it('/admin för icke-admin → /board', async () => {
    renderWithApp(<AppRoutes />, { entry: '/admin', admin: false, width: MOBILE });
    await waitFor(() => expect(location()).toBe('/board'));
  });
});

describe('okända adresser', () => {
  it('okänd route visar NotFound INNE i skalet (ADR 006: * = NotFound)', async () => {
    const { container } = renderWithApp(<AppRoutes />, { entry: '/finns-inte', width: MOBILE });

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(container.querySelector('[data-shell="mobile"]')).not.toBeNull();
  });

  it('okänt runner-id → NotFound i skalet', async () => {
    renderWithApp(<AppRoutes />, { entry: '/runner/ingen-sadan', width: MOBILE });
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});

describe('auth', () => {
  it('utloggad på en skyddad route → /login?next=<path>: Landing med inloggningsdialogen öppen (RUN-145)', async () => {
    renderWithApp(<AppRoutes />, { entry: '/duels?view=live', user: null, width: MOBILE });
    await waitFor(() => expect(location()).toBe('/login?next=%2Fduels%3Fview%3Dlive'));
    expect(await screen.findByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Your group chat deserves a leaderboard', hidden: true })).toBeInTheDocument();
  });

  it('utloggad på /badges → /login?next=%2Fbadges: Landing med inloggningsdialogen öppen, inget skal (RUN-145)', async () => {
    const { container } = renderWithApp(<AppRoutes />, { entry: '/badges', user: null, width: MOBILE });
    await waitFor(() => expect(location()).toBe('/login?next=%2Fbadges'));
    expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
    expect(container.querySelector('[data-shell]')).toBeNull();
    expect(screen.queryByRole('heading', { level: 1, name: 'Badges' })).toBeNull();
  });

  it('utloggad på / ser Landing (publik) — varken skalet eller login, och adressen står kvar', async () => {
    const { container } = renderWithApp(<AppRoutes />, { entry: '/', user: null, width: MOBILE });
    expect(await screen.findByRole('heading', { level: 1, name: 'Your group chat deserves a leaderboard' })).toBeInTheDocument();
    expect(container.querySelector('[data-shell]')).toBeNull();
    expect(screen.queryByLabelText('Username')).toBeNull();
    expect(location()).toBe('/');
  });

  it('Landingens enda guldknapp, Sign in, öppnar inloggningsdialogen: adressen blir /login och Landing består bakom (samma DOM-nod, ingen ommontering)', async () => {
    renderWithApp(<AppRoutes />, { entry: '/', user: null, width: MOBILE });
    const headline = await screen.findByRole('heading', { level: 1, name: 'Your group chat deserves a leaderboard' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('link', { name: 'Sign in to your pack' }));
    await waitFor(() => expect(location()).toBe('/login'));
    expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Username')).toBeInTheDocument();
    // Samma element: Landings animationer (uppräkning, banan) startar inte om när dialogen öppnas.
    expect(screen.getByRole('heading', { level: 1, name: 'Your group chat deserves a leaderboard', hidden: true })).toBe(headline);
  });

  it('utloggad på /login ser Landing med dialogen öppen (ingen egen inloggningssida längre)', async () => {
    renderWithApp(<AppRoutes />, { entry: '/login', user: null, width: MOBILE });
    expect(await screen.findByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
    // Landings rubrik står kvar bakom scrimmen (göms för hjälpmedel av dialogens lager, därför hidden: true).
    expect(screen.getByRole('heading', { level: 1, name: 'Your group chat deserves a leaderboard', hidden: true })).toBeInTheDocument();
    expect(location()).toBe('/login');
  });

  it('utloggad på /login?next=/titles: dialogen öppen och next står kvar i adressen (inloggning → next testas i App.login.test)', async () => {
    renderWithApp(<AppRoutes />, { entry: '/login?next=%2Ftitles', user: null, width: DESKTOP });
    expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
    expect(location()).toBe('/login?next=%2Ftitles');
  });

  it('Esc på en direktladdad /login stänger dialogen: adressen ersätts med / (next släpps), Landing kvar utan dialog', async () => {
    renderWithApp(<AppRoutes />, { entry: '/login?next=%2Ftitles', user: null, width: MOBILE });
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(location()).toBe('/');
    expect(screen.getByRole('heading', { level: 1, name: 'Your group chat deserves a leaderboard' })).toBeInTheDocument();
  });

  it('utloggad på /?tab=titles ser Landing (ingen redirect till login eller /titles)', async () => {
    const { container } = renderWithApp(<AppRoutes />, { entry: '/?tab=titles', user: null, width: MOBILE });
    expect(await screen.findByRole('heading', { level: 1, name: 'Your group chat deserves a leaderboard' })).toBeInTheDocument();
    expect(container.querySelector('[data-shell]')).toBeNull();
    expect(location()).toBe('/?tab=titles');
  });

  it('Landing renderas även på desktop, utan skal', async () => {
    const { container } = renderWithApp(<AppRoutes />, { entry: '/', user: null, width: DESKTOP });
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(container.querySelector('[data-shell]')).toBeNull();
  });

  it('inloggad på /login skickas vidare till next', async () => {
    renderWithApp(<AppRoutes />, { entry: '/login?next=%2Ftitles', width: MOBILE });
    await waitFor(() => expect(location()).toBe('/titles'));
  });

  it.each(['https://evil.example/steal', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/login'])(
    'inloggad på /login?next=%s: aldrig en öppen redirect, bara /board',
    async (next) => {
      renderWithApp(<AppRoutes />, { entry: `/login?next=${encodeURIComponent(next)}`, width: MOBILE });
      await waitFor(() => expect(location()).toBe('/board'));
    },
  );
});

describe('Runner card som route (ADR 006 beslut 6)', () => {
  const openedFromBoard = [
    '/board',
    {
      pathname: '/runner/u-karl',
      state: { background: { pathname: '/board', search: '', hash: '', state: null, key: 'bg' } },
    },
  ];

  it('mobil: helskärmssida med bottenbar och Back-knapp, ingen overlay', async () => {
    const { container } = renderWithApp(<AppRoutes />, { entry: openedFromBoard, width: MOBILE });

    expect(await screen.findByRole('button', { name: /Back/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelector('.rq-tabbar')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: OTHER.name })).toBeInTheDocument();
  });

  it('desktop med background: overlay ovanpå kvarstående bakgrundssida', async () => {
    renderWithApp(<AppRoutes />, { entry: openedFromBoard, width: DESKTOP });

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('heading', { level: 1, name: OTHER.name })).toBeInTheDocument();
    // Bakgrundssidan (Leaderboard) renderas fortfarande under overlayn.
    expect(document.querySelectorAll('[data-shell="desktop"]')).toHaveLength(1);
    expect(location()).toBe('/runner/u-karl');
  });

  it('desktop utan background (direktladdning) renderas som vanlig sida', async () => {
    renderWithApp(<AppRoutes />, { entry: '/runner/u-karl', width: DESKTOP });

    expect(await screen.findByRole('heading', { level: 1, name: OTHER.name })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Esc stänger overlayn; utan historik faller vi tillbaka på /board', async () => {
    renderWithApp(<AppRoutes />, { entry: openedFromBoard, width: DESKTOP });
    await screen.findByRole('dialog');

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(location()).toBe('/board'));
  });

  it('klick på en löpare i Leaderboard öppnar /runner/:id', async () => {
    handlers.getUsersWithRuns = () => ({ success: true, data: [ME, OTHER] });
    renderWithApp(<AppRoutes />, { entry: '/board', width: MOBILE });

    fireEvent.click((await screen.findAllByText(OTHER.name))[0]);
    await waitFor(() => expect(location()).toBe(`/runner/${OTHER.id}`));
  });
});

describe('felgräns runt Runner-overlayn (desktop)', () => {
  const openedFromBoard = [
    '/board',
    { pathname: '/runner/u-karl', state: { background: { pathname: '/board', search: '', hash: '', state: null, key: 'bg' } } },
  ];

  it('ett fel i overlayn ger felkortet, bakgrundssidan och skalet står kvar, och Close tar en ur felläget', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    crash.runnerCard = true;
    renderWithApp(<AppRoutes />, { entry: openedFromBoard, width: DESKTOP });

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Something broke')).toBeInTheDocument();
    // Bakgrundssidan (Leaderboard i skalet) står kvar under felkortet.
    expect(document.querySelectorAll('[data-shell="desktop"]')).toHaveLength(1);
    expect((await screen.findAllByText(OTHER.name)).length).toBeGreaterThan(0);

    crash.runnerCard = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await waitFor(() => expect(location()).toBe('/board'));
    expect(document.querySelectorAll('[data-shell="desktop"]')).toHaveLength(1);
    spy.mockRestore();
  });
});
