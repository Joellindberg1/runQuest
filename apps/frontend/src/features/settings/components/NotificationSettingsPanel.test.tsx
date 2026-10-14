import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NOTIFICATION_GROUPS, NOTIFICATION_KINDS } from '@runquest/shared';
import { newsServer } from '@/features/news/news.fixture';
import { backendApiModule, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import { NotificationSettingsPanel } from './NotificationSettingsPanel';
import { PasswordCard } from './PasswordCard';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);

const fake = backendApiModule.backendApi as Record<string, unknown>;

const TITLES_OTHERS = 'notify.title_others';
const EVENT_OPEN = 'notify.event_open';
const SLOW = { timeout: 4000 };

const kindsIn = (group: string) => NOTIFICATION_KINDS.filter((kind) => kind.group === group);
const switchFor = (label: string) => screen.getByRole('switch', { name: label });
const labelOf = (key: string) => NOTIFICATION_KINDS.find((kind) => kind.key === key)!.label;

let news: ReturnType<typeof newsServer>;

/** Håller PUT-svaret tills testet släpper det, så att det optimistiska läget går att se. */
function holdPut() {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  handlers.putSettings = async (values: unknown) => {
    await gate;
    return news.putSettings(values as Record<string, never>);
  };
  return release;
}

async function renderPanel(props: Parameters<typeof NotificationSettingsPanel>[0] = {}) {
  const view = renderWithApp(<NotificationSettingsPanel {...props} />);
  await screen.findByRole('group', { name: 'Titles' }, SLOW);
  return view;
}

beforeEach(() => {
  resetFakeBackend();
  fake.isAuthenticated = () => true;
  news = newsServer([]);
  handlers.getSettings = news.getSettings;
  handlers.putSettings = (values) => news.putSettings(values as Parameters<typeof news.putSettings>[0]);
});

afterEach(() => {
  delete fake.isAuthenticated;
});

describe('NotificationSettingsPanel', () => {
  it('renderar en switch per slag i NOTIFICATION_KINDS grupperade per sektion med serverns värden', async () => {
    news.server.settings = { [TITLES_OTHERS]: false };
    await renderPanel();

    expect(screen.getAllByRole('switch')).toHaveLength(NOTIFICATION_KINDS.length);
    const populated = NOTIFICATION_GROUPS.filter((group) => kindsIn(group).length > 0);
    for (const group of populated) {
      const section = screen.getByRole('group', { name: group });
      const kinds = kindsIn(group);
      expect(within(section).getAllByRole('switch')).toHaveLength(kinds.length);
      for (const kind of kinds) {
        const expected = kind.key === TITLES_OTHERS ? false : kind.default;
        expect(within(section).getByRole('switch', { name: kind.label })).toHaveAttribute('aria-checked', String(expected));
      }
    }
    // Sektionsrubriken bär antalet på, så en hopfälld sektion ändå visar sitt läge.
    const titles = kindsIn('Titles');
    expect(screen.getByRole('button', { name: new RegExp(`Titles.*${titles.length - 1} of ${titles.length} on`) })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('en sektion utan slag renderas inte', async () => {
    const withoutChallenges = NOTIFICATION_KINDS.filter((kind) => kind.group !== 'Challenges');
    await renderPanel({ kinds: withoutChallenges });

    expect(screen.queryByRole('group', { name: 'Challenges' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Challenges/ })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Titles' })).toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(withoutChallenges.length);
  });

  it('att växla en switch skickar PUT för just den nyckeln och uppdaterar direkt', async () => {
    const user = userEvent.setup();
    await renderPanel();
    const release = holdPut();
    const toggle = switchFor(labelOf(EVENT_OPEN));
    expect(toggle).toBeChecked();

    await user.click(toggle);
    // Svaret är inte här än, men reglaget har redan bytt läge och panelen säger att den sparar.
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');
    expect(news.server.settingsCalls).toEqual([]);

    release();
    await waitFor(() => expect(news.server.settingsCalls).toEqual([{ [EVENT_OPEN]: false }]));
    await waitFor(() => expect(screen.getByRole('status')).toBeEmptyDOMElement());
    expect(toggle).not.toBeChecked();
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
  });

  it('ett misslyckat PUT återställer switchen och annonseras i role=alert', async () => {
    const user = userEvent.setup();
    await renderPanel();
    news.server.failNext = 'Failed to save settings';
    const toggle = switchFor(labelOf(EVENT_OPEN));

    await user.click(toggle);
    expect(await within(screen.getByRole('alert')).findByText(/Couldn.t save that change/)).toBeInTheDocument();
    await waitFor(() => expect(toggle).toBeChecked());
    // En enda alert-region i panelen, och ett nytt val tar bort det gamla felet.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    await user.click(toggle);
    await waitFor(() => expect(screen.getByRole('alert')).toBeEmptyDOMElement());
  });

  it('switchen är nåbar och växlingsbar med tangentbord och har aria-checked', async () => {
    const user = userEvent.setup();
    await renderPanel();
    const first = screen.getAllByRole('switch')[0];

    // Tab går via sektionsrubrikerna till första reglaget.
    for (let steps = 0; steps < 3 && document.activeElement !== first; steps += 1) await user.tab();
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('aria-checked', 'true');

    await user.keyboard(' ');
    await waitFor(() => expect(first).toHaveAttribute('aria-checked', 'false'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(first).toHaveAttribute('aria-checked', 'true'));
    await waitFor(() => expect(news.server.settingsCalls).toHaveLength(2));
  });

  it('ett laddningsfel visar att standardvärden visas och en Retry-knapp, men lösenordskortet fungerar ändå', async () => {
    const user = userEvent.setup();
    handlers.getSettings = () => ({ success: false, error: 'down' });
    handlers.changePassword = vi.fn().mockResolvedValue({ success: true });
    renderWithApp(
      <>
        <NotificationSettingsPanel />
        <PasswordCard />
      </>,
    );

    expect(await screen.findByText(/Couldn.t load your notification settings/, {}, SLOW)).toBeInTheDocument();
    const panel = screen.getByRole('region', { name: 'Notifications' });
    expect(within(panel).getByRole('alert')).toHaveTextContent(/showing the defaults until we can read them\. Retry$/);
    expect(screen.getByText('Defaults shown')).toBeInTheDocument();
    // Standardvärdena visas, men reglagen är låsta så att inget kan skriva över sparade val som inte gick att läsa.
    const toggle = switchFor(labelOf(EVENT_OPEN));
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    await user.click(toggle);
    expect(news.server.settingsCalls).toEqual([]);

    // Lösenordskortet påverkas inte.
    await user.type(screen.getByLabelText('Current password'), 'old-secret');
    await user.type(screen.getByLabelText('New password'), 'new-secret');
    await user.type(screen.getByLabelText('Repeat new password'), 'new-secret');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('status', { name: 'Password status' })).toHaveTextContent('Password changed.');

    // Retry läser om; när servern svarar tar de riktiga värdena över och reglagen låses upp.
    news.server.settings = { [EVENT_OPEN]: false };
    handlers.getSettings = news.getSettings;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(switchFor(labelOf(EVENT_OPEN))).toHaveAttribute('aria-checked', 'false'), SLOW);
    expect(switchFor(labelOf(EVENT_OPEN))).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByText('Defaults shown')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('Reset to defaults är en knapp som bara visas när något är anpassat och återställer med null', async () => {
    const user = userEvent.setup();
    const untouched = await renderPanel();
    expect(screen.queryByRole('button', { name: 'Reset to defaults' })).not.toBeInTheDocument();
    untouched.unmount();

    news.server.settings = { [TITLES_OTHERS]: false, [EVENT_OPEN]: false };
    await renderPanel();
    const reset = await screen.findByRole('button', { name: 'Reset to defaults' });
    expect(switchFor(labelOf(EVENT_OPEN))).not.toBeChecked();

    await user.click(reset);
    await waitFor(() => expect(news.server.settingsCalls).toEqual([{ [TITLES_OTHERS]: null, [EVENT_OPEN]: null }]));
    await waitFor(() => expect(switchFor(labelOf(EVENT_OPEN))).toBeChecked());
    expect(switchFor(labelOf(TITLES_OTHERS))).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Reset to defaults' })).not.toBeInTheDocument();
    expect(news.server.settings).toEqual({});
  });

  it('varje sektion är en grupp med aria-labelledby och Off by default kopplas med aria-describedby', async () => {
    const quiet = { ...NOTIFICATION_KINDS[1], key: 'notify.quiet_kind', label: 'Rank changes between others', default: false };
    await renderPanel({ kinds: [NOTIFICATION_KINDS[0], quiet] });

    const group = screen.getByRole('group', { name: NOTIFICATION_KINDS[0].group });
    expect(group).toHaveAttribute('aria-labelledby');
    const labelledBy = group.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelledBy)).toHaveTextContent(NOTIFICATION_KINDS[0].group);

    const noted = screen.getByRole('switch', { name: 'Rank changes between others' });
    expect(noted).toHaveAccessibleDescription('Off by default');
    expect(noted).not.toBeChecked();
    // Ett reglage på default är inte "Off by default".
    expect(screen.getByRole('switch', { name: NOTIFICATION_KINDS[0].label })).not.toHaveAccessibleDescription();
  });

  it('en sektion fälls ihop och ut av sin rubrik, och startar hopfälld om panelen ber om det', async () => {
    const user = userEvent.setup();
    await renderPanel({ defaultExpanded: false });
    const heading = screen.getByRole('button', { name: /^Titles/ });
    expect(heading).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();

    await user.click(heading);
    expect(heading).toHaveAttribute('aria-expanded', 'true');
    expect(within(screen.getByRole('group', { name: 'Titles' })).getAllByRole('switch')).toHaveLength(kindsIn('Titles').length);
  });

  it('rubrikerna följer headingLevel: panelens titel på den nivån och sektionerna en nivå under', async () => {
    await renderPanel({ headingLevel: 3 });
    expect(screen.getByRole('heading', { level: 3, name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 4 }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it('visar en laddningsstatus i stället för reglage medan inställningarna laddas', async () => {
    handlers.getSettings = () => new Promise(() => {});
    renderWithApp(<NotificationSettingsPanel />);
    expect(await screen.findByRole('status')).toHaveTextContent('Loading…');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});
