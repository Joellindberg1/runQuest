import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);

const MOBILE_WIDTH = 1023;
const DESKTOP_WIDTH = 1024;

const Tree: React.FC = () => (
  <Routes>
    <Route element={<AppShell />}>
      {['/board', '/titles', '/duels', '/events', '/news', '/log', '/profile', '/playbook', '/features', '/settings', '/admin'].map((path) => (
        <Route key={path} path={path} element={<div>page {path}</div>} />
      ))}
      <Route path="/runner/:id" element={<div>runner page</div>} />
      <Route path="*" element={<div>not found page</div>} />
    </Route>
  </Routes>
);

beforeEach(() => {
  resetFakeBackend();
});

describe('AppShell: exakt en variant i DOM (ADR 006 beslut 5)', () => {
  it('1023 px ger mobilvarianten: bottenbar, ingen sidnav', async () => {
    const { container } = renderWithApp(<Tree />, { entry: '/board', width: MOBILE_WIDTH });

    await screen.findByText('page /board');
    expect(container.querySelectorAll('[data-shell]')).toHaveLength(1);
    expect(container.querySelector('[data-shell="mobile"]')).not.toBeNull();
    expect(container.querySelector('.rq-tabbar')).not.toBeNull();
    expect(container.querySelector('.rq-sidenav')).toBeNull();
  });

  it('1024 px ger desktopvarianten: sidnav, ingen bottenbar', async () => {
    const { container } = renderWithApp(<Tree />, { entry: '/board', width: DESKTOP_WIDTH });

    await screen.findByText('page /board');
    expect(container.querySelectorAll('[data-shell]')).toHaveLength(1);
    expect(container.querySelector('[data-shell="desktop"]')).not.toBeNull();
    expect(container.querySelector('.rq-sidenav')).not.toBeNull();
    expect(container.querySelector('.rq-tabbar')).toBeNull();
  });

  it.each([MOBILE_WIDTH, DESKTOP_WIDTH])('varje tour-ankare är unikt vid %d px', async (width) => {
    const { container } = renderWithApp(<Tree />, { entry: '/board', width });
    await screen.findByText('page /board');

    const anchors = Array.from(container.querySelectorAll('[data-tour]')).map((el) => el.getAttribute('data-tour'));
    expect(anchors.length).toBeGreaterThan(0);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it('events-ankaret är header-events på mobil och nav-events på desktop', async () => {
    const mobile = renderWithApp(<Tree />, { entry: '/board', width: MOBILE_WIDTH });
    await screen.findByText('page /board');
    expect(mobile.container.querySelector('[data-tour="header-events"]')).not.toBeNull();
    expect(mobile.container.querySelector('[data-tour="nav-events"]')).toBeNull();
    mobile.unmount();

    const desktop = renderWithApp(<Tree />, { entry: '/board', width: DESKTOP_WIDTH });
    await screen.findByText('page /board');
    expect(desktop.container.querySelector('[data-tour="nav-events"]')).not.toBeNull();
    expect(desktop.container.querySelector('[data-tour="header-events"]')).toBeNull();
  });
});

describe('BottomBar: aktiv flik följer location', () => {
  const activeLabel = (): string | null => {
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const current = nav.querySelector('[aria-current="page"]');
    return current?.textContent ?? null;
  };

  it.each([
    ['/board', 'Ranks'],
    ['/runner/u-karl', 'Ranks'],
    ['/events', 'Ranks'],
    ['/titles', 'Titles'],
    ['/duels', 'Duels'],
    ['/profile', 'You'],
    ['/log', 'You'],
    ['/settings', 'You'],
  ])('%s lyser upp %s', async (entry, label) => {
    renderWithApp(<Tree />, { entry, width: MOBILE_WIDTH });
    await screen.findByRole('navigation', { name: 'Primary' });
    expect(activeLabel()).toBe(label);
  });

  it('ingen flik lyser på en okänd adress, och New är aldrig markerad som aktiv', async () => {
    renderWithApp(<Tree />, { entry: '/nope', width: MOBILE_WIDTH });
    await screen.findByText('not found page');
    expect(activeLabel()).toBeNull();
  });

  it('en tabb navigerar till sin route', async () => {
    renderWithApp(<Tree />, { entry: '/board', width: MOBILE_WIDTH });
    fireEvent.click(await screen.findByRole('link', { name: 'Duels' }));

    await screen.findByText('page /duels');
    expect(screen.getByTestId('location')).toHaveTextContent('/duels');
    expect(activeLabel()).toBe('Duels');
  });
});

describe('SideNav (desktop)', () => {
  it('markerar aktiv rad och håller Leaderboard aktiv på Runner card', async () => {
    renderWithApp(<Tree />, { entry: '/runner/u-karl', width: DESKTOP_WIDTH });
    await screen.findByText('runner page');

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent('Leaderboard');
  });

  it('FAQ och Bug Report är avstängda (finns i designen, saknar sida)', async () => {
    renderWithApp(<Tree />, { entry: '/board', width: DESKTOP_WIDTH });
    await screen.findByText('page /board');

    expect(screen.getByText('FAQ').closest('[aria-disabled="true"]')).not.toBeNull();
    expect(screen.queryByRole('link', { name: /FAQ/ })).toBeNull();
  });
});

describe('Header', () => {
  it('visar gruppnamnet från getGroupInfo', async () => {
    renderWithApp(<Tree />, { entry: '/board', width: MOBILE_WIDTH });
    expect(await screen.findByText('Wolfpack')).toBeInTheDocument();
  });

  it('klockan är en knapp som öppnar popovern, utan räknare när inget är oläst', async () => {
    renderWithApp(<Tree />, { entry: '/board', width: MOBILE_WIDTH });
    const bell = await screen.findByRole('button', { name: 'Pack news' });

    expect(bell).toHaveAttribute('data-tour', 'header-news');
    expect(bell.textContent).toBe('');
  });

  it('kalendern har ingen prick utan öppet event, och prick när ett event är öppet', async () => {
    const first = renderWithApp(<Tree />, { entry: '/board', width: MOBILE_WIDTH });
    await screen.findByRole('link', { name: 'Events' });
    expect(screen.queryByRole('img', { name: 'Event open now' })).toBeNull();
    first.unmount();

    handlers.getEventList = () => ({
      success: true,
      data: {
        events: [{
          id: 'e1', type: 'participation', metric: null, status: 'active',
          startsAt: new Date(Date.now() - 3_600_000).toISOString(), endsAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
          template: { name: 'Evening run', icon: '', description: '', minKm: 3, rewardXp: 25, rewardXp1st: 0, rewardXp2nd: 0, rewardXp3rd: 0, requiresWeather: null },
          myEntry: null, leaderboard: null, participantCount: 0, memberCount: 6,
        }],
      },
    });
    renderWithApp(<Tree />, { entry: '/board', width: MOBILE_WIDTH });
    expect(await screen.findByRole('img', { name: 'Event open now' })).toBeInTheDocument();
  });
});

describe('Right now', () => {
  it('visar inga piller när data saknas (Strava okänd/ej hämtad)', async () => {
    handlers.getStravaStatus = () => ({ success: false, error: 'down' });
    renderWithApp(<Tree />, { entry: '/board', width: MOBILE_WIDTH });
    await screen.findByText('Wolfpack');
    expect(screen.queryByRole('list', { name: 'Right now' })).toBeNull();
  });

  it('Strava ej kopplat: Connect-pillen länkar till /settings och bär tour-ankaret', async () => {
    const { container } = renderWithApp(<Tree />, { entry: '/board', width: MOBILE_WIDTH });
    const pill = await screen.findByRole('link', { name: /Strava.*Connect/ });

    expect(pill).toHaveAttribute('href', '/settings');
    expect(container.querySelector('[data-tour="right-now-strava"]')).toBe(pill);
  });

  it('visar event- och Strava-piller ur befintliga endpoints, med Strava som tour-ankare', async () => {
    handlers.getEventList = () => ({
      success: true,
      data: {
        events: [{
          id: 'e1', type: 'participation', metric: null, status: 'active',
          startsAt: new Date(Date.now() - 3_600_000).toISOString(), endsAt: new Date(Date.now() + 3 * 3_600_000 + 60_000).toISOString(),
          template: { name: 'Evening run', icon: '', description: '', minKm: 3, rewardXp: 25, rewardXp1st: 0, rewardXp2nd: 0, rewardXp3rd: 0, requiresWeather: null },
          myEntry: null, leaderboard: null, participantCount: 0, memberCount: 6,
        }],
      },
    });
    handlers.getStravaStatus = () => ({ success: true, data: { connected: true, expired: false } });
    handlers.getStravaLastSync = () => ({
      success: true,
      data: { last_sync_attempt: null, last_sync_status: 'ok', next_sync_estimated: new Date(Date.now() + 28 * 60_000 + 30_000).toISOString() },
    });

    const { container } = renderWithApp(<Tree />, { entry: '/board', width: MOBILE_WIDTH });
    const list = await screen.findByRole('list', { name: 'Right now' });

    await waitFor(() => expect(within(list).getAllByRole('link')).toHaveLength(2));
    expect(within(list).getByText('Evening run')).toBeInTheDocument();
    expect(within(list).getByText('3h')).toBeInTheDocument();
    expect(within(list).getByText('28 m')).toBeInTheDocument();
    expect(container.querySelector('[data-tour="right-now-strava"]')).toHaveTextContent('Strava');
  });

  it('desktop visar samma data som panel i sidnavens botten', async () => {
    handlers.getStravaStatus = () => ({ success: true, data: { connected: true, expired: false } });
    handlers.getStravaLastSync = () => ({
      success: true,
      data: { last_sync_attempt: null, last_sync_status: 'ok', next_sync_estimated: new Date(Date.now() + 28 * 60_000 + 30_000).toISOString() },
    });

    renderWithApp(<Tree />, { entry: '/board', width: DESKTOP_WIDTH });
    const panel = await screen.findByRole('region', { name: 'Right now' });
    expect(within(panel).getByText('Strava')).toBeInTheDocument();
  });
});

describe('+New-sheeten', () => {
  it('öppnas av mittenknappen och erbjuder Log a run och Send a challenge', async () => {
    renderWithApp(<Tree />, { entry: '/board', width: MOBILE_WIDTH });
    fireEvent.click(await screen.findByRole('button', { name: 'New' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Log a run')).toBeInTheDocument();
    expect(within(dialog).getByText('Send a challenge')).toBeInTheDocument();
  });

  it('Log a run navigerar till /log och stänger sheeten', async () => {
    renderWithApp(<Tree />, { entry: '/board', width: MOBILE_WIDTH });
    fireEvent.click(await screen.findByRole('button', { name: 'New' }));
    fireEvent.click(await screen.findByRole('button', { name: /Log a run/ }));

    await screen.findByText('page /log');
    expect(screen.getByTestId('location')).toHaveTextContent('/log');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Send a challenge navigerar till /duels?send=1', async () => {
    renderWithApp(<Tree />, { entry: '/board', width: MOBILE_WIDTH });
    fireEvent.click(await screen.findByRole('button', { name: 'New' }));
    fireEvent.click(await screen.findByRole('button', { name: /Send a challenge/ }));

    await screen.findByText('page /duels');
    expect(screen.getByTestId('location')).toHaveTextContent('/duels?send=1');
  });
});

describe('AvatarMenu', () => {
  const openMenu = async () => {
    fireEvent.click(await screen.findByRole('button', { name: /Account menu/ }));
    return screen.findByText('Log out');
  };

  it('visar Admin bara för admin', async () => {
    const plain = renderWithApp(<Tree />, { entry: '/board', width: MOBILE_WIDTH, admin: false });
    await openMenu();
    expect(screen.queryByRole('button', { name: /Admin/ })).toBeNull();
    plain.unmount();

    renderWithApp(<Tree />, { entry: '/board', width: MOBILE_WIDTH, admin: true });
    await openMenu();
    expect(screen.getByRole('button', { name: /Admin/ })).toBeInTheDocument();
  });

  it('mobil: Playbook, Feature & Version och Settings; level och placering ur leaderboard-datan', async () => {
    renderWithApp(<Tree />, { entry: '/board', width: MOBILE_WIDTH });
    await openMenu();

    expect(screen.getByRole('button', { name: /Playbook/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Feature & Version/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Settings/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Level \d+ · #2 in the pack/)).toBeInTheDocument());
  });

  it('desktop: Playbook och Feature & Version ligger i sidnavigeringen, inte i menyn', async () => {
    renderWithApp(<Tree />, { entry: '/board', width: DESKTOP_WIDTH });
    await openMenu();

    expect(screen.queryByRole('button', { name: /Playbook/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Settings/ })).toBeInTheDocument();
  });

  it('Settings navigerar till /settings', async () => {
    renderWithApp(<Tree />, { entry: '/board', width: MOBILE_WIDTH });
    await openMenu();
    fireEvent.click(screen.getByRole('button', { name: /Settings/ }));

    await screen.findByText('page /settings');
    expect(screen.getByTestId('location')).toHaveTextContent('/settings');
  });
});

describe('ShellErrorBoundary: ett panelfel ger aldrig vit skärm', () => {
  const Boom: React.FC = () => {
    throw new Error('panel exploded');
  };
  const BrokenTree: React.FC = () => (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/board" element={<div>page /board</div>} />
        <Route path="/duels" element={<Boom />} />
      </Route>
    </Routes>
  );

  it.each([MOBILE_WIDTH, DESKTOP_WIDTH])('en route som kastar ger felkortet och skalet står kvar (%d px)', async (width) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = renderWithApp(<BrokenTree />, { entry: '/duels', width });

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Something broke')).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(container.querySelector(width === MOBILE_WIDTH ? '.rq-tabbar' : '.rq-sidenav')).not.toBeNull();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    spy.mockRestore();
  });

  it('en ny sida börjar om utan fel (navigering ur felläget)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderWithApp(<BrokenTree />, { entry: '/duels', width: MOBILE_WIDTH });
    await screen.findByText('Something broke');

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Primary' })).getAllByRole('link')[0]);
    expect(await screen.findByText('page /board')).toBeInTheDocument();
    expect(screen.queryByText('Something broke')).toBeNull();
    spy.mockRestore();
  });
});
