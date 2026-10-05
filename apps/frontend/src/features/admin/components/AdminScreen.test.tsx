import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import AdminPage from '@/pages/AdminPage';
import type { AdminUser, TitleLeaderboard } from '@/shared/services/backendApi';
import { handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);

const SETTINGS = { base_xp: 15, xp_per_km: 2, bonus_5km: 5, bonus_10km: 15, bonus_15km: 25, bonus_20km: 50, min_run_distance: 1 };
const LADDER = [{ days: 3, multiplier: 1.3 }, { days: 7, multiplier: 1.5 }, { days: 21, multiplier: 2 }];

const member = (id: string, name: string, over: Partial<AdminUser> = {}): AdminUser => ({
  id, name, email: `${name.split(' ')[0].toLowerCase()}@wolfpack.se`, total_xp: 5539, current_level: 24, total_km: 900,
  current_streak: 8, longest_streak: 12, created_at: '2026-01-01', total_runs: 159, ...over,
});
const KARL = member('u-karl', 'Karl Persson');
const JOEL = member('u-joel', 'Joel Lindberg', { total_xp: 5243, total_runs: 133, current_streak: 4 });

const title = (id: string, name: string, metric_key: string, unlock_requirement = 0): TitleLeaderboard => ({
  id, name, description: `${name}: regeln ur databasen.`, unlock_requirement, metric_key, holder: null, runners_up: [],
});

const SLOW = { timeout: 4000 };

function renderAdmin(entry = '/admin') {
  return renderWithApp(
    <Routes>
      <Route path="/admin" element={<AdminPage />} />
    </Routes>,
    { entry, admin: true },
  );
}

const group = (name: string) => screen.getByRole('region', { name });

beforeEach(() => {
  resetFakeBackend();
  handlers.getAdminSettings = () => ({ success: true, data: SETTINGS });
  handlers.getStreakMultipliers = () => ({ success: true, data: LADDER });
  handlers.getAllUsers = () => ({ success: true, data: [KARL, JOEL] });
  handlers.updateAdminSettings = () => ({ success: true });
  handlers.updateStreakMultipliers = () => ({ success: true });
});

describe('Admin — XP settings', () => {
  it('Save är låst tills inställningarna och trappan lästs in, och upplåst sedan', async () => {
    renderAdmin();
    expect(screen.getByRole('button', { name: 'Save all settings' })).toBeDisabled();
    expect(screen.getByText('Loading the XP settings')).toBeInTheDocument();
    expect(await screen.findByLabelText('XP per run')).toHaveValue(15);
    expect(screen.getByRole('button', { name: 'Save all settings' })).toBeEnabled();
  });

  it('visar de tre korten med riktiga värden: grundinställningar, distansbonusar och trappan i stigande ordning', async () => {
    renderAdmin();
    await screen.findByLabelText('XP per run');
    expect(within(group('Basic XP')).getByLabelText('XP per km')).toHaveValue(2);
    expect(within(group('Distance bonuses')).getByLabelText('20 km+ bonus')).toHaveValue(50);
    const ladder = within(group('Streak multipliers'));
    expect(ladder.getAllByRole('spinbutton').map((input) => (input as HTMLInputElement).value)).toEqual(['1.3', '1.5', '2']);
    expect(ladder.getByLabelText('3 days')).toHaveValue(1.3);
  });

  it('Min km for streak och Min run date är skrivskyddade — Save skickar dem aldrig', async () => {
    renderAdmin();
    await screen.findByLabelText('XP per run');
    expect(screen.getByLabelText('Min km for streak')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Min run date')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Min km for run')).not.toHaveAttribute('readonly');
  });

  it('misslyckas trappan att läsas in: felkort med Retry, Save förblir låst och inget skickas — Retry låser upp', async () => {
    handlers.getStreakMultipliers = () => ({ success: false, error: 'boom' });
    renderAdmin();
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save all settings' })).toBeDisabled();
    expect(screen.queryByLabelText('XP per run')).not.toBeInTheDocument();

    handlers.getStreakMultipliers = () => ({ success: true, data: LADDER });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByLabelText('XP per run')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save all settings' })).toBeEnabled();
  });

  it('Save skickar fälten och hela trappan och bekräftar i statusregionen', async () => {
    const update = vi.fn().mockResolvedValue({ success: true });
    const updateLadder = vi.fn().mockResolvedValue({ success: true });
    handlers.updateAdminSettings = update;
    handlers.updateStreakMultipliers = updateLadder;
    renderAdmin();
    fireEvent.change(await screen.findByLabelText('XP per run'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save all settings' }));

    await waitFor(() => expect(update).toHaveBeenCalledWith({ base_xp: 20, xp_per_km: 2, bonus_5km: 5, bonus_10km: 15, bonus_15km: 25, bonus_20km: 50, min_run_distance: 1 }));
    expect(updateLadder).toHaveBeenCalledWith(LADDER);
    expect(await screen.findByRole('status', { name: 'Settings status' })).toHaveTextContent('Settings saved');
  });

  it('en trappa utanför 1–9.99 stoppas före FÖRSTA anropet — grundinställningarna sparas aldrig halvt', async () => {
    const update = vi.fn().mockResolvedValue({ success: true });
    const updateLadder = vi.fn().mockResolvedValue({ success: true });
    handlers.updateAdminSettings = update;
    handlers.updateStreakMultipliers = updateLadder;
    renderAdmin();
    fireEvent.change(await screen.findByLabelText('3 days'), { target: { value: '12.5' } });
    expect(screen.getByLabelText('3 days')).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Save all settings' }));
    expect(await screen.findByRole('alert', { name: 'Settings error' })).toHaveTextContent('The multiplier for 3 days must be between 1 and 9.99');
    expect(update).not.toHaveBeenCalled();
    expect(updateLadder).not.toHaveBeenCalled();
  });

  it('serverns 400-text visas ordagrant i alert-regionen', async () => {
    handlers.updateStreakMultipliers = () => ({ success: false, error: 'Multiplier must be between 1 and 9.99' });
    renderAdmin();
    fireEvent.change(await screen.findByLabelText('3 days'), { target: { value: '1.4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save all settings' }));
    expect(await screen.findByRole('alert', { name: 'Settings error' })).toHaveTextContent('Multiplier must be between 1 and 9.99');
  });

  it('ett tomt fält stoppas före anropet i stället för att skickas som null', async () => {
    const update = vi.fn().mockResolvedValue({ success: true });
    handlers.updateAdminSettings = update;
    renderAdmin();
    fireEvent.change(await screen.findByLabelText('XP per km'), { target: { value: '' } });
    expect(screen.getByLabelText('XP per km')).toHaveValue(null);
    fireEvent.click(screen.getByRole('button', { name: 'Save all settings' }));
    expect(await screen.findByRole('alert', { name: 'Settings error' })).toHaveTextContent('Every field needs a number');
    expect(update).not.toHaveBeenCalled();
  });

  it('nytt trappsteg läggs till i listan (och sparas först vid Save); ofullständigt steg ger ett fel', async () => {
    renderAdmin();
    await screen.findByLabelText('XP per run');
    fireEvent.click(screen.getByRole('button', { name: 'Add streak step' }));
    expect(await screen.findByRole('alert', { name: 'Settings error' })).toHaveTextContent('Enter both the number of days and a multiplier');

    fireEvent.change(screen.getByLabelText('Days'), { target: { value: '14' } });
    fireEvent.change(screen.getByLabelText('Multiplier'), { target: { value: '1.8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add streak step' }));
    expect(await within(group('Streak multipliers')).findByLabelText('14 days')).toHaveValue(1.8);
    expect(screen.getByRole('status', { name: 'Settings status' })).toHaveTextContent('Nothing is stored until you save');
    // stigande ordning: 3, 7, 14, 21
    const labels = within(group('Streak multipliers')).getAllByRole('spinbutton').map((input) => (input as HTMLInputElement).value);
    expect(labels).toEqual(['1.3', '1.5', '1.8', '2']);
  });

  it('en enda guldknapp i vyn', async () => {
    const { container } = renderAdmin();
    await screen.findByLabelText('XP per run');
    expect(container.querySelectorAll('.rq-btn--primary')).toHaveLength(1);
  });
});

describe('Admin — flikar', () => {
  it('fyra flikar över ?view=, XP settings är standard och val av flik byter panel', async () => {
    renderAdmin();
    await screen.findByLabelText('XP per run');
    const tabs = screen.getByRole('tablist', { name: 'Admin view' });
    expect(within(tabs).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['XP settings', 'Users', 'Titles', 'Security']);
    expect(within(tabs).getByRole('tab', { name: 'XP settings' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(within(tabs).getByRole('tab', { name: 'Users' }));
    expect(await screen.findByRole('region', { name: 'Members' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('view=users');
  });

  it('det man skrivit i XP settings överlever ett byte till Users och tillbaka', async () => {
    renderAdmin();
    fireEvent.change(await screen.findByLabelText('XP per run'), { target: { value: '31' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Users' }));
    await screen.findByRole('region', { name: 'Members' });
    fireEvent.click(screen.getByRole('tab', { name: 'XP settings' }));
    expect(await screen.findByLabelText('XP per run')).toHaveValue(31);
  });

  it('en adress med ?view=titles öppnar den fliken direkt', async () => {
    handlers.getTitleLeaderboard = () => ({ success: true, data: [title('t1', 'The Batman', 'nightRunCount', 7)] });
    renderAdmin('/admin?view=titles');
    expect(await screen.findByRole('region', { name: 'Titles' })).toBeInTheDocument();
  });
});

describe('Admin — members', () => {
  const openUsers = () => renderAdmin('/admin?view=users');

  it('listar medlemmarna med e-post och nivå · XP · rundor · streak', async () => {
    openUsers();
    const list = await screen.findByRole('list', { name: 'Members' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('Karl Persson')).toBeInTheDocument();
    expect(within(list).getByText('karl@wolfpack.se')).toBeInTheDocument();
    expect(within(list).getByText('Level 24 · 5 539 XP · 159 runs · 8 streak')).toBeInTheDocument();
    expect(screen.getByText('2 members')).toBeInTheDocument();
  });

  it('listan går inte att läsa: felkort med Retry (inte en tom lista som påstår att ingen finns)', async () => {
    handlers.getAllUsers = () => ({ success: false, error: 'down' });
    openUsers();
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText(/No members yet/)).not.toBeInTheDocument();
    handlers.getAllUsers = () => ({ success: true, data: [KARL] });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Karl Persson')).toBeInTheDocument();
  });

  it('Reset password: fältet öppnas på raden, för kort lösenord stoppas, giltigt skickas och bekräftas', async () => {
    const reset = vi.fn().mockResolvedValue({ success: true });
    handlers.resetUserPassword = reset;
    openUsers();
    fireEvent.click(await screen.findByRole('button', { name: 'Reset password for Karl Persson' }));
    const field = screen.getByLabelText('New password for Karl Persson');
    expect(field).toHaveFocus();

    fireEvent.change(field, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert', { name: 'Members error' })).toHaveTextContent('Password must be at least 6 characters');
    expect(reset).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: 'new-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(reset).toHaveBeenCalledWith('u-karl', 'new-secret'));
    expect(await screen.findByRole('status', { name: 'Members status' })).toHaveTextContent('Password reset.');
    expect(screen.queryByLabelText('New password for Karl Persson')).not.toBeInTheDocument();
  });

  it('Cancel stänger fältet utan anrop', async () => {
    const reset = vi.fn();
    handlers.resetUserPassword = reset;
    openUsers();
    fireEvent.click(await screen.findByRole('button', { name: 'Reset password for Joel Lindberg' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('New password for Joel Lindberg')).not.toBeInTheDocument();
    expect(reset).not.toHaveBeenCalled();
  });

  it('Add member: alla fält krävs, lösenordet minst 6 tecken, och en ny medlem hamnar i listan', async () => {
    const create = vi.fn().mockResolvedValue({ success: true, data: member('u-new', 'Anna Berg') });
    handlers.createUser = create;
    openUsers();
    await screen.findByRole('list', { name: 'Members' });

    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
    expect(await screen.findByRole('alert', { name: 'Members error' })).toHaveTextContent('Please fill in all fields');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Anna Berg' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'anna@wolfpack.se' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
    expect(await screen.findByRole('alert', { name: 'Members error' })).toHaveTextContent('Password must be at least 6 characters');
    expect(create).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('Anna Berg', 'anna@wolfpack.se', 'secret-1'));
    expect(await screen.findByText('Anna Berg')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Members status' })).toHaveTextContent('Member added.');
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });

  it('serverns fel vid Add member visas i alert', async () => {
    handlers.createUser = () => ({ success: false, error: 'Email already in use' });
    openUsers();
    await screen.findByRole('list', { name: 'Members' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Anna' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'karl@wolfpack.se' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
    expect(await screen.findByRole('alert', { name: 'Members error' })).toHaveTextContent('Email already in use');
  });

  it('en enda guldknapp i vyn (Add member)', async () => {
    const { container } = openUsers();
    await screen.findByRole('list', { name: 'Members' });
    expect(container.querySelectorAll('.rq-btn--primary')).toHaveLength(1);
  });
});

describe('Admin — titles', () => {
  const BOARD = [title('t1', 'The Batman', 'nightRunCount', 7), title('t2', 'The Ultra Man', 'totalKm', 100)];

  it('listar titlarna ur databasen med regel och låsgräns (inte fyra hårdkodade)', async () => {
    handlers.getTitleLeaderboard = () => ({ success: true, data: BOARD });
    renderAdmin('/admin?view=titles');
    const list = await screen.findByRole('list', { name: 'Titles' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('The Batman: regeln ur databasen.')).toBeInTheDocument();
    expect(within(list).getByText('Unlocks at 7 runs')).toBeInTheDocument();
  });

  it('Refresh title leaderboards anropar backend och bekräftar; ett fel visas i alert', async () => {
    handlers.getTitleLeaderboard = () => ({ success: true, data: BOARD });
    const refresh = vi.fn().mockResolvedValue({ success: true });
    handlers.refreshTitleLeaderboards = refresh;
    renderAdmin('/admin?view=titles');
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh title leaderboards' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('status', { name: 'Titles status' })).toHaveTextContent('Title leaderboards refreshed.');
  });

  it('titellistan går inte att läsa: felkort med Retry', async () => {
    handlers.getTitleLeaderboard = () => ({ success: false, error: 'down' });
    renderAdmin('/admin?view=titles');
    expect(await screen.findByRole('button', { name: 'Retry' }, SLOW)).toBeInTheDocument();
  });
});

describe('Admin — security', () => {
  it('adminlösenordet är fortfarande inte kopplat: svaret säger det och fältet töms', async () => {
    renderAdmin('/admin?view=security');
    const field = await screen.findByLabelText('New admin password');
    fireEvent.change(field, { target: { value: 'whatever' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('status', { name: 'Admin password status' })).toHaveTextContent('not connected to the backend yet');
    expect(field).toHaveValue('');
  });

  it('Run backfill visar summan och en rad per användare, fel i rött', async () => {
    handlers.backfillStravaExtendedData = () => ({
      success: true, data: { totalUpdated: 12, summary: [{ user: 'Karl Persson', updated: 12 }, { user: 'Joel Lindberg', updated: 0, error: 'Token refresh failed' }] },
    });
    renderAdmin('/admin?view=security');
    fireEvent.click(await screen.findByRole('button', { name: 'Run backfill' }));
    const result = await screen.findByRole('status', { name: 'Backfill result' });
    await waitFor(() => expect(result).toHaveTextContent('Total updated: 12 runs'));
    expect(result).toHaveTextContent('Karl Persson12 runs');
    expect(result).toHaveTextContent('Joel LindbergToken refresh failed');
  });

  it('misslyckad backfill: ett fel i alert (tidigare tyst)', async () => {
    handlers.backfillStravaExtendedData = () => ({ success: false, error: 'Strava is down' });
    renderAdmin('/admin?view=security');
    fireEvent.click(await screen.findByRole('button', { name: 'Run backfill' }));
    expect(await screen.findByRole('alert', { name: 'Backfill error' })).toHaveTextContent('Strava is down');
  });

  it('en enda guldknapp i vyn (Change password); backfill är sekundär', async () => {
    const { container } = renderAdmin('/admin?view=security');
    await screen.findByRole('button', { name: 'Run backfill' });
    expect(container.querySelectorAll('.rq-btn--primary')).toHaveLength(1);
  });
});
