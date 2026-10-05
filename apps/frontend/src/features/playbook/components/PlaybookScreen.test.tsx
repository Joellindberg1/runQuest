import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import PlaybookPage from '@/pages/PlaybookPage';
import type { TitleLeaderboard } from '@/shared/services/backendApi';
import { XP_CONFIG, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);

const MOBILE = 390;
const DESKTOP = 1280;
const SLOW = { timeout: 4000 };

// Fixturens konfiguration är medvetet INTE produktionens (trappan 3/7/14/21 dagar) — sidan ska läsa den ur config-endpointen.
const CONFIG = {
  settings: { base_xp: 20, xp_per_km: 3, bonus_5km: 7, bonus_10km: 17, bonus_15km: 27, bonus_20km: 57, min_run_distance: 1.5 },
  streak_multipliers: XP_CONFIG.streak_multipliers,
};

const title = (id: string, name: string, metric_key: string, unlock_requirement = 0): TitleLeaderboard => ({
  id, name, description: `${name}: regeln ur databasen.`, unlock_requirement, metric_key, holder: null, runners_up: [],
});
const BOARD = [title('t-batman', 'The Batman', 'nightRunCount', 7), title('t-ultra', 'The Ultra Man', 'totalKm', 100)];

function renderPlaybook(entry = '/playbook', width = DESKTOP) {
  return renderWithApp(
    <Routes>
      <Route path="/playbook" element={<PlaybookPage />} />
    </Routes>,
    { entry, width },
  );
}

beforeEach(() => {
  resetFakeBackend();
  handlers.getXpConfig = () => ({ success: true, data: CONFIG });
  handlers.getTitleLeaderboard = () => ({ success: true, data: BOARD });
});

describe('Playbook — desktop', () => {
  it('rubrik, nio kapitelflikar och första kapitlet med siffrorna ur konfigurationen', async () => {
    renderPlaybook();
    expect(await screen.findByRole('heading', { level: 1, name: 'Playbook' })).toBeInTheDocument();
    const tabs = await screen.findByRole('tablist', { name: 'Playbook chapters' });
    expect(within(tabs).getAllByRole('tab')).toHaveLength(9);
    expect(within(tabs).getByRole('tab', { name: 'What counts as a run' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'What counts as a run' })).toBeInTheDocument();
    expect(screen.getByText(/A run counts from 1\.5 km/)).toBeInTheDocument();
  });

  it('XP-formeln läser bas, XP/km och distansbonusarna ur /config/xp — inte ur kod', async () => {
    renderPlaybook('/playbook?view=xp');
    const table = await screen.findByRole('region', { name: 'The numbers' });
    const rows = within(table).getAllByRole('term').map((term) => term.textContent);
    expect(rows).toEqual(['Base per run', 'Per kilometre', 'From 5 km', 'From 10 km', 'From 15 km', 'From 20 km']);
    const values = within(table).getAllByRole('definition').map((definition) => definition.textContent);
    expect(values).toEqual(['20', '× 3', '+7', '+17', '+27', '+57']);
    expect(screen.getByText(/Base 20, plus 3 XP per kilometre/)).toBeInTheDocument();
  });

  it('streak-trappan är config-trappan (3/7/14/21), inte shareds standard (5/15/30 …)', async () => {
    renderPlaybook('/playbook?view=streaks');
    const table = await screen.findByRole('region', { name: 'The ladder' });
    const terms = within(table).getAllByRole('term').map((term) => term.textContent);
    expect(terms).toEqual([
      expect.stringContaining('From day 3'), expect.stringContaining('From day 7'), expect.stringContaining('From day 14'), expect.stringContaining('From day 21'),
    ]);
    expect(within(table).getAllByRole('definition').map((definition) => definition.textContent)).toEqual(['1.3×', '1.5×', '1.8×', '2×']);
  });

  it('flikbyte: kapitlet byts, adressen följer (?view=) och Previous/Next går runt i ändarna', async () => {
    renderPlaybook();
    await screen.findByRole('heading', { level: 2, name: 'What counts as a run' });
    fireEvent.click(screen.getByRole('tab', { name: 'Streaks' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Streaks' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('view=streaks');
    expect(screen.getByText('3 / 9')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Next chapter: Levels/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Levels' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'What counts as a run' }));
    fireEvent.click(await screen.findByRole('button', { name: /Previous chapter: Fair play/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Fair play' })).toBeInTheDocument();
  });

  it('titelkapitlet listar titlarna ur databasen med regel och låsgräns', async () => {
    renderPlaybook('/playbook?view=titles');
    const heading = await screen.findByRole('heading', { level: 3, name: 'All titles · 2' });
    const list = heading.closest('section') as HTMLElement;
    expect(within(list).getByText('The Batman')).toBeInTheDocument();
    expect(within(list).getByText('The Batman: regeln ur databasen.')).toBeInTheDocument();
    expect(within(list).getByText('Unlocks at 7 runs')).toBeInTheDocument();
    expect(within(list).getByText('Unlocks at 100.0 km')).toBeInTheDocument();
  });

  it('titellistan går inte att läsa: felkort med Retry, resten av kapitlet står kvar', async () => {
    handlers.getTitleLeaderboard = () => ({ success: false, error: 'down' });
    renderPlaybook('/playbook?view=titles');
    expect(await screen.findByRole('button', { name: 'Retry' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText(/Titles are held, not awarded/)).toBeInTheDocument();
    handlers.getTitleLeaderboard = () => ({ success: true, data: BOARD });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'All titles · 2' })).toBeInTheDocument();
  });

  it('titellistan hämtas först när titelkapitlet visas', async () => {
    const board = vi.fn().mockResolvedValue({ success: true, data: BOARD });
    handlers.getTitleLeaderboard = board;
    renderPlaybook();
    await screen.findByRole('heading', { level: 2, name: 'What counts as a run' });
    expect(board).not.toHaveBeenCalled();
  });

  it('konfigurationen går inte att läsa: standardsiffrorna visas och sidan säger det, Retry hämtar de riktiga', async () => {
    handlers.getXpConfig = () => ({ success: false, error: 'down' });
    renderPlaybook('/playbook?view=xp');
    const note = await screen.findByText(/Showing the standard numbers/, undefined, SLOW);
    expect(note).toBeInTheDocument();
    const table = screen.getByRole('region', { name: 'The numbers' });
    expect(within(table).getAllByRole('definition').map((definition) => definition.textContent)).toEqual(['15', '× 2', '+5', '+15', '+25', '+50']);

    handlers.getXpConfig = () => ({ success: true, data: CONFIG });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText(/Showing the standard numbers/)).not.toBeInTheDocument());
    expect(within(screen.getByRole('region', { name: 'The numbers' })).getAllByRole('definition')[0]).toHaveTextContent('20');
  });

  it('statusregionen finns permanent (tom när allt är som det ska)', async () => {
    renderPlaybook();
    await screen.findByRole('heading', { level: 2, name: 'What counts as a run' });
    expect(screen.getByRole('status', { name: 'Playbook numbers' })).toBeEmptyDOMElement();
  });

  it('ingen guldknapp i vyn — sidan är läsning, inte handling', async () => {
    const { container } = renderPlaybook();
    await screen.findByRole('heading', { level: 2, name: 'What counts as a run' });
    expect(container.querySelectorAll('.rq-btn--primary')).toHaveLength(0);
  });
});

describe('Playbook — mobil', () => {
  it('nio rader i ett dragspel, första kapitlet öppet, och rubrikerna är riktiga knappar med aria-expanded', async () => {
    renderPlaybook('/playbook', MOBILE);
    const first = await screen.findByRole('button', { name: /What counts as a run/ });
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(9);
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(8);
    expect(screen.getByText('9 ch')).toBeInTheDocument();
    expect(screen.getByText(/A run counts from 1\.5 km/)).toBeInTheDocument();
  });

  it('ett kapitel i taget: att öppna ett annat stänger det första, att trycka på det öppna fäller ihop allt', async () => {
    renderPlaybook('/playbook', MOBILE);
    await screen.findByText(/A run counts from 1\.5 km/);
    fireEvent.click(screen.getByRole('button', { name: /The XP formula/ }));
    expect(await screen.findByText(/Base 20, plus 3 XP per kilometre/)).toBeInTheDocument();
    expect(screen.queryByText(/A run counts from 1\.5 km/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /The XP formula/ })).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByRole('button', { name: /The XP formula/ }));
    expect(screen.queryByText(/Base 20, plus 3 XP per kilometre/)).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button', { expanded: true })).toHaveLength(0);
  });

  it('det öppna kapitlet har sin tabell med siffror ur konfigurationen, och knappen pekar på sin panel', async () => {
    renderPlaybook('/playbook?view=xp', MOBILE);
    const button = await screen.findByRole('button', { name: /The XP formula/ });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(button.getAttribute('aria-controls') as string) as HTMLElement;
    expect(panel).toHaveAccessibleName(/The XP formula/);
    expect(within(panel).getAllByRole('definition').map((definition) => definition.textContent)).toEqual(['20', '× 3', '+7', '+17', '+27', '+57']);
  });

  it('titelkapitlet i dragspelet listar databastitlarna', async () => {
    renderPlaybook('/playbook?view=titles', MOBILE);
    expect(await screen.findByRole('heading', { level: 3, name: 'All titles · 2' })).toBeInTheDocument();
    expect(screen.getByText('The Ultra Man')).toBeInTheDocument();
  });

  it('inga flikar och ingen Previous/Next på mobil', async () => {
    renderPlaybook('/playbook', MOBILE);
    await screen.findByRole('button', { name: /What counts as a run/ });
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Chapter navigation' })).not.toBeInTheDocument();
  });
});
