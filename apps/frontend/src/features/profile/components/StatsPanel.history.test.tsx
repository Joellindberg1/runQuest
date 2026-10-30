import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { handlers, ME } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import { run, user } from '../profile.fixture';
import { StatsPanel } from './StatsPanel';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
// Panelens chunk kommer aldrig: provet gäller att svaret inte väntar på den. (Egen fil: React.lazy cachar sitt första löfte per modul.)
vi.mock('./positionPanelLoader', () => ({ loadPositionPanel: () => new Promise(() => {}) }));

const ME_ROW = user({ id: ME.id, name: ME.name, total_xp: 5243, runs: [run({ id: 'm1', date: '2026-10-03', distance: 12 })] });
const NOW = new Date('2026-10-04T10:00:00Z');

describe('StatsPanel — the position request and the panel chunk', () => {
  it('asks for the position history while the panel chunk is still on its way, so the two are fetched side by side', async () => {
    const getPositionHistory = vi.fn(() => new Promise(() => {}));
    handlers.getPositionHistory = getPositionHistory;

    renderWithApp(<StatsPanel user={ME_ROW} now={NOW} isDesktop view="position" onChange={vi.fn()} label="Your stats" showPosition />, { entry: '/profile' });

    expect(await screen.findByText('Loading position')).toBeInTheDocument();
    await vi.waitFor(() => expect(getPositionHistory).toHaveBeenCalledExactlyOnceWith(8));
  });

  it('asks for nothing on the other tabs', async () => {
    const getPositionHistory = vi.fn(() => new Promise(() => {}));
    handlers.getPositionHistory = getPositionHistory;

    renderWithApp(<StatsPanel user={ME_ROW} now={NOW} isDesktop view="distance" onChange={vi.fn()} label="Your stats" showPosition />, { entry: '/profile' });
    await screen.findByRole('tabpanel');

    expect(getPositionHistory).not.toHaveBeenCalled();
  });
});
