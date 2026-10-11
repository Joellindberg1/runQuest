import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BADGE_SERIES, MAX_SHOWCASE, MAX_TIER } from '@runquest/shared';
import type { BadgeUserItem } from '@runquest/shared';
import { buildCollection } from '../badgeModel';
import { ShowcasePicker } from './ShowcasePicker';

// Väljaren (RUN-129, spec F3, Council 16-18): rader med växlare, platspanel, SAVE DISPLAY och sparlägen. Beteende, inte utseende — serienamn kommer ur shared.

const api = vi.hoisted(() => ({ saveShowcase: vi.fn() }));
vi.mock('../api', () => ({ badgesApi: api }));

const [milestoner, earthTrotter, climber, streakKeeper, earlyBird, nightOwl, speedster, precisionist] = BADGE_SERIES;
const ME = { viewerId: 'u-me', ownerId: 'u-me' };
const item = (series: string, tier: number): BadgeUserItem => ({ series, tier, earned_at: '2026-10-01T12:00:00Z', seen_tier: tier });
const OWNED = [item(milestoner.key, 3), item(earthTrotter.key, 2), item(climber.key, 1), item(streakKeeper.key, MAX_TIER), item(earlyBird.key, 4)];
const rowsOf = (showcase: string[], items: BadgeUserItem[] = OWNED) => buildCollection({ items, showcase }, undefined, ME);

function renderPicker(showcase: string[], props: { rows?: ReturnType<typeof rowsOf>; onClose?: () => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (rows: ReturnType<typeof rowsOf>) => (
    <QueryClientProvider client={client}>
      <ShowcasePicker rows={rows} userId="u-me" onClose={props.onClose ?? (() => {})} />
    </QueryClientProvider>
  );
  const view = render(ui(props.rows ?? rowsOf(showcase)));
  return { ...view, rerenderRows: (rows: ReturnType<typeof rowsOf>) => view.rerender(ui(rows)) };
}

/** Växlaren för en serie: knappens namn är "{Serie}: Show" / "{Serie}: On display — N". */
const toggleOf = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}:`) });
const slots = () => within(screen.getByRole('list', { name: 'Badges on display' })).getAllByRole('listitem');
const slotNames = () => slots().map((slot) => slot.querySelector('.rq-badge-slot__name')?.textContent ?? null);
const saveButton = () => screen.getByRole('button', { name: /^(SAVE DISPLAY|SAVING…)$/ });

beforeEach(() => {
  api.saveShowcase.mockReset();
  api.saveShowcase.mockImplementation(async (series: string[]) => ({ showcase: series }));
});

describe('ShowcasePicker — rader (Council 18 steg 1)', () => {
  it('en rad per serie i BADGE_SERIES-ordning, med nivåchip på intjänade', () => {
    renderPicker([streakKeeper.key]);
    const rows = within(screen.getByRole('list', { name: 'Choose badges to display' })).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('.rq-badge-pick__name')?.textContent)).toEqual(BADGE_SERIES.map((series) => series.name));
    expect(within(rows[0]).getByText('Rare')).toBeInTheDocument();
    expect(within(rows[3]).getByText('Legendary')).toBeInTheDocument();
  });

  it('låsta rader: "Locked — cannot be selected" och en "Locked"-växlare som inte är en knapp', () => {
    renderPicker([]);
    const list = screen.getByRole('list', { name: 'Choose badges to display' });
    const lockedRows = [nightOwl, speedster, precisionist].map((series) => within(list).getAllByRole('listitem')[BADGE_SERIES.indexOf(series)]);
    for (const row of lockedRows) {
      expect(row).toHaveAttribute('data-state', 'locked');
      expect(within(row).getByText('Locked — cannot be selected')).toBeInTheDocument();
      expect(within(row).getByText('Locked')).toBeInTheDocument();
      expect(within(row).queryByRole('button')).toBeNull();
    }
    // Bara intjänade serier har en växlare.
    expect(within(list).getAllByRole('button')).toHaveLength(OWNED.length);
  });

  it('växlaren är en <button aria-pressed> med texten "Show" / "On display — N" och serienamnet i sitt namn', () => {
    renderPicker([streakKeeper.key, milestoner.key]);
    expect(toggleOf(streakKeeper.name)).toHaveAttribute('aria-pressed', 'true');
    expect(toggleOf(streakKeeper.name)).toHaveTextContent('On display — 1');
    expect(toggleOf(milestoner.name)).toHaveTextContent('On display — 2');
    expect(toggleOf(climber.name)).toHaveAttribute('aria-pressed', 'false');
    expect(toggleOf(climber.name)).toHaveTextContent('Show');
    expect(toggleOf(climber.name).tagName).toBe('BUTTON');
  });

  it('aria-pressed växlar när man klickar, och platsen följer med', () => {
    renderPicker([streakKeeper.key]);
    fireEvent.click(toggleOf(climber.name));
    expect(toggleOf(climber.name)).toHaveAttribute('aria-pressed', 'true');
    expect(toggleOf(climber.name)).toHaveTextContent('On display — 2');
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    fireEvent.click(toggleOf(climber.name));
    expect(toggleOf(climber.name)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });
});

describe('ShowcasePicker — 3/3 (Council 17)', () => {
  const FULL = () => [streakKeeper.key, earlyBird.key, milestoner.key];

  it('vid 3/3: övriga växlare är aria-disabled="true" och den SYNLIGA texten förklarar varför', () => {
    renderPicker(FULL());
    expect(screen.getByText('3 of 3 on display — remove one first.')).toBeVisible();
    for (const series of [earthTrotter, climber]) {
      expect(toggleOf(series.name)).toHaveAttribute('aria-disabled', 'true');
      expect(toggleOf(series.name)).toHaveAttribute('aria-describedby');
      expect(document.getElementById(toggleOf(series.name).getAttribute('aria-describedby') as string)).toHaveTextContent('3 of 3 on display — remove one first.');
    }
  });

  it('de valda växlarna förblir användbara (går att ta bort) och raderna/texten dimmas inte', () => {
    renderPicker(FULL());
    expect(toggleOf(streakKeeper.name)).not.toHaveAttribute('aria-disabled');
    const row = toggleOf(climber.name).closest('li') as HTMLElement;
    expect(row).not.toHaveAttribute('aria-disabled');
    expect(row.getAttribute('style')).toBeNull();
    expect(screen.getByText('3 of 3 on display — remove one first.').closest('[style]')).toBeNull();
  });

  it('ett klick på en spärrad växlare lägger inte till något (max 3)', () => {
    renderPicker(FULL());
    fireEvent.click(toggleOf(climber.name));
    expect(toggleOf(climber.name)).toHaveAttribute('aria-pressed', 'false');
    expect(slotNames()).toEqual([streakKeeper.name, earlyBird.name, milestoner.name]);
  });

  it('texten försvinner och växlarna öppnas igen när en plats frigörs', () => {
    renderPicker(FULL());
    fireEvent.click(screen.getByRole('button', { name: `Remove ${earlyBird.name} from display` }));
    expect(screen.queryByText('3 of 3 on display — remove one first.')).toBeNull();
    expect(toggleOf(climber.name)).not.toHaveAttribute('aria-disabled');
  });

  it('snabba klick på flera serier: aldrig fler än tre valda (T5)', () => {
    renderPicker([]);
    for (const series of [earthTrotter, climber, streakKeeper, earlyBird, milestoner]) fireEvent.click(toggleOf(series.name));
    expect(slotNames()).toEqual([earthTrotter.name, climber.name, streakKeeper.name]);
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(MAX_SHOWCASE);
  });
});

describe('ShowcasePicker — platspanelen (Council 18 steg 3)', () => {
  it('alltid tre platser: fyllda i valordning, resten som tomma platser', () => {
    renderPicker([climber.key]);
    expect(slots()).toHaveLength(MAX_SHOWCASE);
    expect(slotNames()).toEqual([climber.name, null, null]);
    expect(within(slots()[1]).getByText('Empty slot')).toBeInTheDocument();
    expect(within(slots()[2]).getByText('Empty slot')).toBeInTheDocument();
  });

  it('✕ har etiketten "Remove {Serie} from display" och tar bort serien; ordningen = valordningen', () => {
    renderPicker([streakKeeper.key, milestoner.key]);
    fireEvent.click(toggleOf(earlyBird.name));
    expect(slotNames()).toEqual([streakKeeper.name, milestoner.name, earlyBird.name]);
    fireEvent.click(screen.getByRole('button', { name: `Remove ${streakKeeper.name} from display` }));
    expect(slotNames()).toEqual([milestoner.name, earlyBird.name, null]);
    expect(toggleOf(milestoner.name)).toHaveTextContent('On display — 1');
    expect(toggleOf(earlyBird.name)).toHaveTextContent('On display — 2');
    expect(toggleOf(streakKeeper.name)).toHaveAttribute('aria-pressed', 'false');
  });

  it('nivån står som text i platsen (aldrig bara färg)', () => {
    renderPicker([streakKeeper.key]);
    expect(within(slots()[0]).getByText('Legendary')).toBeInTheDocument();
  });

  it('statusändringar läses upp i en aria-live="polite"-region', () => {
    renderPicker([streakKeeper.key]);
    const live = document.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live).not.toBeNull();
    fireEvent.click(toggleOf(climber.name));
    expect(live).toHaveTextContent(`${climber.name} added to display, position 2.`);
    fireEvent.click(screen.getByRole('button', { name: `Remove ${streakKeeper.name} from display` }));
    expect(live).toHaveTextContent(`${streakKeeper.name} removed from display.`);
  });

  it('en serie jag inte längre äger städas ur utkastet (T5): ingen plats och inget i sparanropet', async () => {
    const { rerenderRows } = renderPicker([streakKeeper.key, milestoner.key]);
    expect(slotNames()).toEqual([streakKeeper.name, milestoner.name, null]);
    // Streak Keeper nedgraderas bort under tiden: serien är låst igen.
    rerenderRows(rowsOf([milestoner.key], OWNED.filter((entry) => entry.series !== streakKeeper.key)));
    expect(slotNames()).toEqual([milestoner.name, null, null]);
    expect(screen.queryByRole('button', { name: new RegExp(`^${streakKeeper.name}:`) })).toBeNull();
    fireEvent.click(toggleOf(climber.name));
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.saveShowcase).toHaveBeenCalledWith([milestoner.key, climber.key]));
  });
});

describe('ShowcasePicker — spara (Council 18 steg 2)', () => {
  it('SAVE DISPLAY är avstängd när inget ändrats och slås på av en ändring — ändras tillbaka är den avstängd igen', () => {
    renderPicker([streakKeeper.key]);
    expect(saveButton()).toBeDisabled();
    fireEvent.click(toggleOf(climber.name));
    expect(saveButton()).toBeEnabled();
    fireEvent.click(toggleOf(climber.name));
    expect(saveButton()).toBeDisabled();
  });

  it('en omordning räknas som ändring: borttagen och tillagd igen hamnar sist', () => {
    renderPicker([streakKeeper.key, milestoner.key]);
    fireEvent.click(toggleOf(streakKeeper.name));
    fireEvent.click(toggleOf(streakKeeper.name));
    expect(slotNames()).toEqual([milestoner.name, streakKeeper.name, null]);
    expect(saveButton()).toBeEnabled();
  });

  it('sparar valet i vald ordning (PUT) och visar den gröna bekräftelsen i en role="status"', async () => {
    renderPicker([streakKeeper.key]);
    fireEvent.click(toggleOf(milestoner.name));
    fireEvent.click(toggleOf(earlyBird.name));
    fireEvent.click(saveButton());
    expect(await screen.findByText('Saved — your Board card is updated.')).toBeInTheDocument();
    expect(api.saveShowcase).toHaveBeenCalledTimes(1);
    expect(api.saveShowcase).toHaveBeenCalledWith([streakKeeper.key, milestoner.key, earlyBird.key]);
    expect(screen.getByRole('status')).toHaveTextContent('Saved — your Board card is updated.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('"SAVING…" och avstängd medan anropet pågår; valet kan inte ändras under tiden', async () => {
    let finish: (value: { showcase: string[] }) => void = () => {};
    api.saveShowcase.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderPicker([streakKeeper.key]);
    fireEvent.click(toggleOf(climber.name));
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveButton()).toHaveTextContent('SAVING…'));
    expect(saveButton()).toBeDisabled();
    fireEvent.click(toggleOf(earlyBird.name));
    fireEvent.click(screen.getByRole('button', { name: `Remove ${streakKeeper.name} from display` }));
    expect(slotNames()).toEqual([streakKeeper.name, climber.name, null]);
    finish({ showcase: [streakKeeper.key, climber.key] });
    expect(await screen.findByText('Saved — your Board card is updated.')).toBeInTheDocument();
  });

  it('sparat-bekräftelsen försvinner när man ändrar valet igen', async () => {
    renderPicker([streakKeeper.key]);
    fireEvent.click(toggleOf(climber.name));
    fireEvent.click(saveButton());
    await screen.findByText('Saved — your Board card is updated.');
    fireEvent.click(toggleOf(earlyBird.name));
    expect(screen.queryByText('Saved — your Board card is updated.')).toBeNull();
  });

  it('fel: röd kant-text i role="alert" med RETRY, valet ligger kvar, RETRY sparar om', async () => {
    api.saveShowcase.mockRejectedValueOnce(new Error('boom'));
    renderPicker([streakKeeper.key]);
    fireEvent.click(toggleOf(climber.name));
    fireEvent.click(saveButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not save. Your pick is still here — try again.');
    expect(alert).toHaveAttribute('data-status', 'error');
    expect(screen.queryByText(/^Saved/)).toBeNull();
    expect(slotNames()).toEqual([streakKeeper.name, climber.name, null]);
    expect(saveButton()).toBeEnabled();

    fireEvent.click(within(alert).getByRole('button', { name: 'RETRY' }));
    expect(await screen.findByText('Saved — your Board card is updated.')).toBeInTheDocument();
    expect(api.saveShowcase).toHaveBeenCalledTimes(2);
    expect(api.saveShowcase).toHaveBeenLastCalledWith([streakKeeper.key, climber.key]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('EN guldknapp i väljaren: SAVE DISPLAY — ingen fylld primärknapp och ingen annan secondary', () => {
    renderPicker([streakKeeper.key]);
    const panel = screen.getByRole('region', { name: 'ON DISPLAY' });
    expect(panel.querySelectorAll('.rq-btn--primary')).toHaveLength(0);
    expect(panel.querySelectorAll('.rq-btn--secondary')).toHaveLength(1);
    expect(saveButton()).toHaveClass('rq-btn--secondary');
  });

  it('"Preview on leaderboard" byggs inte', () => {
    renderPicker([streakKeeper.key, earlyBird.key, milestoner.key]);
    expect(screen.queryByText(/preview on leaderboard/i)).toBeNull();
  });
});

describe('ShowcasePicker — fokus och stängning', () => {
  it('fokus hamnar i väljaren när den öppnas', () => {
    renderPicker([]);
    expect(screen.getByRole('region', { name: 'ON DISPLAY' })).toHaveFocus();
  });

  it('Close och Esc anropar onClose', () => {
    const onClose = vi.fn();
    renderPicker([], { onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(toggleOf(climber.name), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('inga hårdkodade tal i klartext som kan glida från MAX_SHOWCASE: räknaren visar "N / MAX"', () => {
    renderPicker([streakKeeper.key]);
    expect(screen.getByText(`1 / ${MAX_SHOWCASE}`)).toBeInTheDocument();
  });
});
