import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { handlers, resetFakeBackend } from '@/test/fakeBackend';
import { run } from '../profile.fixture';
import { EditRunSheet } from './EditRunSheet';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);

const TODAY = '2026-10-11';
const manual = run({ id: 'r-manual', date: '2026-10-02', distance: 8, source: 'manual' });
const strava = run({ id: 'r-strava', date: '2026-10-03', distance: 10.5, source: 'strava' });

function renderSheet(target = manual) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const props = { onClose: vi.fn(), onDone: vi.fn(), onRestoreFocus: vi.fn() };
  render(
    <QueryClientProvider client={client}>
      <EditRunSheet run={target} today={TODAY} {...props} />
    </QueryClientProvider>,
  );
  return props;
}

beforeEach(() => {
  resetFakeBackend();
});

describe('EditRunSheet — Strava-runda (RUN-139)', () => {
  it('Strava-runda: distans och datum skrivskyddade, ingen Save', () => {
    renderSheet(strava);

    // Inga inputs: varken datum eller distans går att ändra.
    expect(screen.queryByLabelText('Date')).toBeNull();
    expect(screen.queryByLabelText('Distance (km)')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    // Värdena visas ändå, som text.
    const details = screen.getByRole('region', { name: 'Date and distance' });
    expect(within(details).getByText('2026-10-03')).toBeInTheDocument();
    expect(within(details).getByText(/10[.,]5 km/)).toBeInTheDocument();
    // Ingen Save, och förklaringen står där.
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    expect(screen.getByText("Synced from Strava. Distance and date come from Strava and can't be changed here.")).toBeInTheDocument();
    // Delete fortsatt spärrad.
    expect(screen.getByRole('button', { name: /Delete run/ })).toBeDisabled();
    // Rundans XP-uppdelning finns kvar.
    expect(screen.getByRole('region', { name: 'What this run earned' })).toBeInTheDocument();
  });

  it('Strava-runda: rubriken är "Run details" och arket har varken form-element eller submit-knapp (inget PUT kan skickas)', () => {
    renderSheet(strava);
    const sheet = screen.getByRole('dialog', { name: 'Run details' });
    expect(sheet.querySelector('form')).toBeNull();
    expect(screen.queryByRole('form')).toBeNull();
    expect(sheet.querySelector('button[type="submit"]')).toBeNull();
    // Alla knappar är uttryckligen type="button" (en knapp utan type vore submit i ett form).
    for (const button of within(sheet).getAllByRole('button')) {
      expect(button.getAttribute('type')).not.toBe('submit');
    }
  });

  it('Strava-runda: Close i foten anropar onClose', async () => {
    const { onClose } = renderSheet(strava);
    const sheet = screen.getByRole('dialog', { name: 'Run details' });
    fireEvent.click(within(sheet).getByText('Close', { selector: 'button' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('Strava-runda: fokus hamnar på ✕ i headern när arket öppnas (inget fält att fokusera)', async () => {
    renderSheet(strava);
    const sheet = screen.getByRole('dialog', { name: 'Run details' });
    const header = sheet.querySelector('header') as HTMLElement;
    const closeX = within(header).getByRole('button', { name: 'Close' });
    await waitFor(() => expect(document.activeElement).toBe(closeX));
  });

  it('servern svarar 409 på radering (gammal klient som tror att rundan är manuell): serverns text visas, arket står kvar', async () => {
    handlers.deleteRun = async () => ({ success: false, error: 'Strava runs are read-only' });
    const { onDone, onClose } = renderSheet(manual);
    fireEvent.click(screen.getByRole('button', { name: 'Delete run' }));
    const sheet = await screen.findByRole('dialog', { name: 'Delete run' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete run' }));
    await waitFor(() => expect(within(sheet).getByRole('alert')).toHaveTextContent('Strava runs are read-only'));
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('EditRunSheet — manuell runda', () => {
  it('manuell runda: redigerbar som förut', async () => {
    const updateRun = vi.fn(async (...args: unknown[]) => ({
      success: true,
      data: { ...manual, ...(args[1] as { distance: number }), xp_gained: 61 },
    }));
    handlers.updateRun = updateRun;
    const { onDone } = renderSheet(manual);

    expect(screen.getByLabelText('Date')).toHaveValue('2026-10-02');
    expect(screen.getByLabelText('Distance (km)')).toHaveValue('8');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled(); // inget ändrat än
    expect(screen.queryByText(/Synced from Strava/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete run' })).toBeEnabled();

    fireEvent.change(screen.getByLabelText('Distance (km)'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(updateRun).toHaveBeenCalledWith('r-manual', { distance: 9 });
  });
});

describe('EditRunSheet — 409 från servern', () => {
  it('servern svarar 409 (gammal klient eller kapplöpning): felet visas i arket, ingen krasch, arket förblir öppet', async () => {
    // backendApi.updateRun fångar serverns fel och returnerar { success: false, error } — så ser ett 409 ut för hooken.
    handlers.updateRun = async () => ({ success: false, error: 'Strava runs are read-only' });
    const { onDone, onClose } = renderSheet(manual);

    fireEvent.change(screen.getByLabelText('Distance (km)'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(alert).toHaveTextContent('Strava runs are read-only'));
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Formuläret finns kvar och Save är användbar igen (inte fastnat i "Saving…").
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });
});
