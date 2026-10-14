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
const CHALLENGE_LOST = 'notify.challenge_lost_me';
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
    news.server.settings = { [TITLES_OTHERS]: false, [CHALLENGE_LOST]: false };
    await renderPanel();

    expect(screen.getAllByRole('switch')).toHaveLength(NOTIFICATION_KINDS.length);
    const populated = NOTIFICATION_GROUPS.filter((group) => kindsIn(group).length > 0);
    for (const group of populated) {
      const section = screen.getByRole('group', { name: group });
      const kinds = kindsIn(group);
      expect(within(section).getAllByRole('switch')).toHaveLength(kinds.length);
      for (const kind of kinds) {
        const expected = kind.key === TITLES_OTHERS || kind.key === CHALLENGE_LOST ? false : kind.default;
        expect(within(section).getByRole('switch', { name: kind.label })).toHaveAttribute('aria-checked', String(expected));
      }
    }
    // Sektionsrubriken bär antalet på, så en hopfälld sektion ändå visar sitt läge. Datat är medvetet osymmetriskt (4 av 5 på) så att på och av inte kan förväxlas.
    const challenges = kindsIn('Challenges');
    expect(challenges.length).toBeGreaterThan(2);
    expect(screen.getByRole('button', { name: new RegExp(`Challenges.*${challenges.length - 1} of ${challenges.length} on`) })).toBeInTheDocument();
    const titles = kindsIn('Titles');
    expect(screen.getByRole('button', { name: new RegExp(`Titles.*${titles.length - 1} of ${titles.length} on`) })).toBeInTheDocument();
    // Räknas ur registret: slag som startar avstängda (default false) och de två avstängda här är inte påslagna.
    const switchedOn = NOTIFICATION_KINDS.filter((kind) => (kind.key === TITLES_OTHERS || kind.key === CHALLENGE_LOST ? false : kind.default));
    expect(screen.getByText(`${switchedOn.length} of ${NOTIFICATION_KINDS.length} on`)).toBeInTheDocument();
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
    await user.click(screen.getByLabelText('Current password'));
    await user.paste('old-secret');
    await user.click(screen.getByLabelText('New password'));
    await user.paste('new-secret');
    await user.click(screen.getByLabelText('Repeat new password'));
    await user.paste('new-secret');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('status', { name: 'Password status' })).toHaveTextContent('Password changed.');

    // Retry och Reset är länkknappar med den delade tryckytan (44 px mobil, 24 desktop).
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveClass('rq-notify__link');

    // Retry läser om; när servern svarar tar de riktiga värdena över och reglagen låses upp.
    news.server.settings = { [EVENT_OPEN]: false };
    handlers.getSettings = news.getSettings;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(switchFor(labelOf(EVENT_OPEN))).toHaveAttribute('aria-checked', 'false'), SLOW);
    expect(switchFor(labelOf(EVENT_OPEN))).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByText('Defaults shown')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('ett bakgrundsfel med cachade värden låser inte reglagen och säger inte Defaults shown', async () => {
    const user = userEvent.setup();
    news.server.settings = { [EVENT_OPEN]: false };
    let readsFail = false;
    let reads = 0;
    handlers.getSettings = () => {
      reads += 1;
      return readsFail ? { success: false, error: 'down' } : news.getSettings();
    };
    handlers.putSettings = () => ({ success: false, error: 'Failed to save settings' });
    await renderPanel();
    expect(switchFor(labelOf(EVENT_OPEN))).not.toBeChecked();

    // PUT:en misslyckas och omläsningen efter den misslyckas också, men värdena finns kvar i cachen.
    readsFail = true;
    const readsBefore = reads;
    await user.click(switchFor(labelOf(TITLES_OTHERS)));
    expect(await screen.findByText(/Couldn.t save that change/)).toBeInTheDocument();
    await waitFor(() => expect(reads).toBeGreaterThan(readsBefore + 1), SLOW);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.queryByText('Defaults shown')).not.toBeInTheDocument();
    expect(screen.queryByText(/Couldn.t load/)).not.toBeInTheDocument();
    for (const toggle of screen.getAllByRole('switch')) expect(toggle).not.toHaveAttribute('aria-disabled');
    expect(switchFor(labelOf(EVENT_OPEN))).not.toBeChecked();
    expect(switchFor(labelOf(TITLES_OTHERS))).toBeChecked();
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(/Couldn.t save that change/);
  });

  it('fokus hamnar inte på body efter Retry', async () => {
    const user = userEvent.setup();
    handlers.getSettings = () => ({ success: false, error: 'down' });
    renderWithApp(<NotificationSettingsPanel />);
    const retry = await screen.findByRole('button', { name: 'Retry' }, SLOW);
    retry.focus();

    await user.click(retry);
    await screen.findByRole('button', { name: 'Retry' }, SLOW);
    const panel = screen.getByRole('region', { name: 'Notifications' });
    expect(document.body).not.toHaveFocus();
    expect(panel).toContainElement(document.activeElement as HTMLElement);
  });

  it('retryFocus flyttar fokus till det elementet i stället för panelens titel efter Retry', async () => {
    const user = userEvent.setup();
    handlers.getSettings = () => ({ success: false, error: 'down' });
    renderWithApp(
      <>
        <h2 tabIndex={-1}>Host heading</h2>
        <NotificationSettingsPanel retryFocus={() => screen.getByRole('heading', { name: 'Host heading' })} />
      </>,
    );
    await user.click(await screen.findByRole('button', { name: 'Retry' }, SLOW));
    expect(screen.getByRole('heading', { name: 'Host heading' })).toHaveFocus();
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
    expect(reset).toHaveClass('rq-notify__link');

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

  it('showTotal={false} tar bort totalsumman men behåller sektionernas räknare och "Defaults shown"', async () => {
    const total = new RegExp(`^\\d+ of ${NOTIFICATION_KINDS.length} on$`);
    const shown = await renderPanel();
    expect(screen.getByText(total)).toBeInTheDocument();
    shown.unmount();

    const hidden = await renderPanel({ showTotal: false });
    expect(screen.queryByText(total)).not.toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Titles' })).getByRole('button', { name: /^Titles/ })).toHaveTextContent(/\d+ of \d+ on/);
    hidden.unmount();

    handlers.getSettings = () => ({ success: false, error: 'down' });
    renderWithApp(<NotificationSettingsPanel showTotal={false} />);
    expect(await screen.findByText('Defaults shown', {}, SLOW)).toBeInTheDocument();
  });

  it('visar en laddningsstatus i stället för reglage medan inställningarna laddas', async () => {
    handlers.getSettings = () => new Promise(() => {});
    renderWithApp(<NotificationSettingsPanel />);
    expect(await screen.findByRole('status')).toHaveTextContent('Loading…');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});
