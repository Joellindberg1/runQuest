import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AppRoutes } from './routes';
import { ME, OTHER, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
// Turerna startar driver.js efter en timer; de har egna tester och stör inte routingen.
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));

const MOBILE = 390;
const DESKTOP = 1280;

const location = () => screen.getByTestId('location').textContent;

beforeEach(() => {
  resetFakeBackend();
});

describe('varje route renderar utan krasch inne i skalet', () => {
  it.each([
    '/board', '/titles', '/duels', '/events', '/news', '/log', '/profile',
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

  it('/news är tom-vyn med knapp tillbaka till /board', async () => {
    renderWithApp(<AppRoutes />, { entry: '/news', width: MOBILE });

    expect(await screen.findByRole('heading', { name: 'Pack News' })).toBeInTheDocument();
    expect(screen.getByText('Pack News kommer i inkrement 9.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Back to the board' }));
    await waitFor(() => expect(location()).toBe('/board'));
  });

  it('/board visar den gamla Leaderboard-skärmen med gruppens löpare', async () => {
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
  it('utloggad på en skyddad route → /login?next=<path>', async () => {
    renderWithApp(<AppRoutes />, { entry: '/duels?view=live', user: null, width: MOBILE });
    await waitFor(() => expect(location()).toBe('/login?next=%2Fduels%3Fview%3Dlive'));
    expect(await screen.findByLabelText('Username')).toBeInTheDocument();
  });

  it('utloggad på / ser login i stället för skalet', async () => {
    const { container } = renderWithApp(<AppRoutes />, { entry: '/', user: null, width: MOBILE });
    expect(await screen.findByLabelText('Username')).toBeInTheDocument();
    expect(container.querySelector('[data-shell]')).toBeNull();
  });

  it('inloggad på /login skickas vidare till next', async () => {
    renderWithApp(<AppRoutes />, { entry: '/login?next=%2Ftitles', width: MOBILE });
    await waitFor(() => expect(location()).toBe('/titles'));
  });
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
