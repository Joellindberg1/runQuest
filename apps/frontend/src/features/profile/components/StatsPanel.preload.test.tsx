import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { handlers, ME, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import { run, user } from '../profile.fixture';
import type { StatView } from '../statsModel';
import { StatsPanel } from './StatsPanel';
import { loadPositionPanel } from './positionPanelLoader';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
// Samma laddare som panelen använder, men med ett räknat anrop: provet gäller NÄR panelens chunk begärs, inte vad den innehåller.
vi.mock('./positionPanelLoader', async (importOriginal) => {
  const original = await importOriginal<typeof import('./positionPanelLoader')>();
  return { ...original, loadPositionPanel: vi.fn(original.loadPositionPanel) };
});

// Position-panelen är en egen chunk (den hör inte hemma i profilens ingångsbunt). Chunken begärs först när den behövs: fliken väljs, eller användaren är på väg dit
// (pekare över fliken, tangentbordsfokus), så att den redan är hämtad när klicket kommer.

const NOW = new Date('2026-10-04T10:00:00Z');
const ME_ROW = user({ id: ME.id, name: ME.name, total_xp: 5243, runs: [run({ id: 'm1', date: '2026-10-03', distance: 12 })] });

function renderPanel(view: StatView) {
  renderWithApp(<StatsPanel user={ME_ROW} now={NOW} isDesktop view={view} onChange={vi.fn()} label="Your stats" showPosition />, { entry: '/profile' });
}

beforeEach(() => {
  resetFakeBackend();
  handlers.getPositionHistory = () => new Promise(() => {});
  vi.mocked(loadPositionPanel).mockClear();
});

describe('StatsPanel — the Position panel chunk', () => {
  it('is not requested while another tab is shown and nobody is heading for Position', async () => {
    renderPanel('distance');
    await userEvent.hover(screen.getByRole('tab', { name: 'Streak' }));
    await userEvent.tab();

    expect(loadPositionPanel).not.toHaveBeenCalled();
  });

  it('is requested when the pointer moves over the Position tab, before it is clicked', async () => {
    renderPanel('distance');

    await userEvent.hover(screen.getByRole('tab', { name: 'Position' }));

    expect(loadPositionPanel).toHaveBeenCalled();
  });

  it('is requested when the Position tab gets keyboard focus', async () => {
    renderPanel('consistency');

    await userEvent.tab();
    expect(loadPositionPanel).not.toHaveBeenCalled();
    screen.getByRole('tab', { name: 'Position' }).focus();

    expect(loadPositionPanel).toHaveBeenCalled();
  });

  it('is requested at once when Position is the selected tab (?view=position)', async () => {
    renderPanel('position');

    expect(await screen.findByText('Loading position')).toBeInTheDocument();
    expect(loadPositionPanel).toHaveBeenCalled();
  });
});
