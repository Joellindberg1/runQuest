import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BADGE_SERIES, MAX_TIER, requirementText, tierFlavor } from '@runquest/shared';
import type { BadgeUserItem } from '@runquest/shared';
import type { GroupBadges } from '../api';
import { buildCollection, type BadgeRow } from '../badgeModel';
import { BadgeEmblem } from './BadgeEmblem';
import { BadgeEmblemDetail } from './BadgeEmblemDetail';

// 44 px-emblemet som knapp med detaljpopover (spec F10.4, F11, Leads beslut Q2 / L4): nivån utan tooltip, nåbar med tryck och tangentbord.
// Beteende och tillgänglighet. Texterna räknas fram ur shared — inga serienamn skrivs som strängar här.

const [milestoner, earthTrotter, climber, streakKeeper, , nightOwl] = BADGE_SERIES;
const ME = { viewerId: 'u-me', ownerId: 'u-me' };
const OTHER = { viewerId: 'u-me', ownerId: 'u-other' };

const item = (series: string, tier: number): BadgeUserItem => ({ series, tier, earned_at: '2026-10-01T12:00:00Z', seen_tier: tier });
function group(held: Record<string, number>, memberCount = 6): GroupBadges {
  const holders: GroupBadges['holders'] = {};
  for (const series of BADGE_SERIES) {
    holders[series.key] = {};
    for (let tier = 1; tier <= MAX_TIER; tier += 1) holders[series.key][String(tier)] = held[series.key] ?? 0;
  }
  return { members: [], holders, member_count: memberCount };
}
const HELD = group({ [milestoner.key]: 5, [earthTrotter.key]: 6, [climber.key]: 4, [streakKeeper.key]: 1, [nightOwl.key]: 3 });
const ITEMS = [item(milestoner.key, 3), item(earthTrotter.key, 2), item(climber.key, 1), item(streakKeeper.key, MAX_TIER)];

const collection = (showcase: string[], viewer = ME, grid: GroupBadges | null = HELD) => buildCollection({ items: ITEMS, showcase }, grid ?? undefined, viewer);
const rowOf = (rows: BadgeRow[], series: string) => rows.find((row) => row.series === series) as BadgeRow;

const trigger = (name: string) => screen.getByRole('button', { name });
const open = async (name: string) => {
  fireEvent.click(trigger(name));
  return screen.findByRole('dialog');
};
/** Webbläsaren gör Enter (keydown) och Space (keyup) på en <button> till ett klick; jsdom gör det inte, så det efterliknas här. */
function press(element: HTMLElement, key: 'Enter' | ' ') {
  element.focus();
  const dispatch = key === 'Enter' ? fireEvent.keyDown : fireEvent.keyUp;
  const proceed = dispatch(element, { key });
  if (proceed && element.tagName === 'BUTTON') fireEvent.click(element);
}

describe('BadgeEmblemDetail — knappen (F10.4)', () => {
  it('är en <button type="button"> med det tillgängliga namnet "{Tier} {Serie}" och ett dekorativt cp-emblem inuti', () => {
    const row = rowOf(collection([]), milestoner.key);
    render(<BadgeEmblemDetail row={row} />);
    const button = trigger(`Rare ${milestoner.name}`);
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    const emblem = button.querySelector('.rq-badge');
    expect(emblem).toHaveClass('rq-badge--cp');
    expect(emblem).toHaveAttribute('aria-hidden', 'true');
    expect(button.querySelector('[role="img"]')).toBeNull();
  });

  it('låst serie: namnet "Locked {Serie}"', () => {
    render(<BadgeEmblemDetail row={rowOf(collection([]), nightOwl.key)} />);
    expect(trigger(`Locked ${nightOwl.name}`)).toBeInTheDocument();
  });

  it('namnet är samma sträng som emblemets egen etikett (en källa för "{Tier} {Serie}")', () => {
    for (const row of collection([])) {
      const emblem = render(<BadgeEmblem series={row.series} tier={row.tier} size="cp" />);
      const label = screen.getByRole('img').getAttribute('aria-label') as string;
      emblem.unmount();
      const detail = render(<BadgeEmblemDetail row={row} />);
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
      detail.unmount();
    }
  });

  it('ingen title (dubbelläsning) varken på knappen eller inuti den', () => {
    render(<BadgeEmblemDetail row={rowOf(collection([]), milestoner.key)} />);
    const button = trigger(`Rare ${milestoner.name}`);
    expect(button).not.toHaveAttribute('title');
    expect(button.querySelector('[title]')).toBeNull();
  });

  it('Radix-attributen finns: aria-haspopup="dialog", aria-expanded="false" stängd, aria-controls när öppen', async () => {
    render(<BadgeEmblemDetail row={rowOf(collection([]), milestoner.key)} />);
    const button = trigger(`Rare ${milestoner.name}`);
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const dialog = await open(`Rare ${milestoner.name}`);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button.getAttribute('aria-controls')).toBe(dialog.id);
  });

  it('är nåbar med tangentbordet: fokuserbar (ingen tabindex=-1), och Enter respektive Space öppnar', async () => {
    render(<BadgeEmblemDetail row={rowOf(collection([]), milestoner.key)} />);
    const button = trigger(`Rare ${milestoner.name}`);
    expect(button).not.toHaveAttribute('tabindex', '-1');
    button.focus();
    expect(button).toHaveFocus();

    press(button, 'Enter');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    press(trigger(`Rare ${milestoner.name}`), ' ');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

describe('BadgeEmblemDetail — popovern, intjänad serie (F10.4)', () => {
  it('stängd vid start; ett klick öppnar en dialog vars namn är serienamnet', async () => {
    render(<BadgeEmblemDetail row={rowOf(collection([]), milestoner.key)} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    const dialog = await open(`Rare ${milestoner.name}`);
    expect(dialog).toHaveAccessibleName(milestoner.name);
  });

  it('innehåll i ordning: serienamn + nivåchip, pips "Tier N of 6", krav utan nivåprefix, flavor på egen rad, held-by', async () => {
    render(<BadgeEmblemDetail row={rowOf(collection([]), milestoner.key)} />);
    const dialog = await open(`Rare ${milestoner.name}`);
    const view = within(dialog);
    expect(view.getByRole('heading', { name: milestoner.name })).toBeInTheDocument();
    expect(view.getByText('Rare')).toHaveAttribute('data-tier', 'rare');
    expect(view.getByRole('img', { name: 'Tier 3 of 6' })).toBeInTheDocument();
    const req = view.getByText(requirementText(milestoner, 3));
    expect(req.textContent?.startsWith('Rare')).toBe(false);
    const flavor = view.getByText(`"${tierFlavor(milestoner, 3)}"`);
    expect(flavor.tagName).toBe('P');
    expect(flavor).not.toBe(req);
    expect(view.getByText('Held by 5 of 6 in your pack')).toBeInTheDocument();
    // Ordningen i DOM: krav före flavor före held-by.
    const text = Array.from(dialog.querySelectorAll('p')).map((p) => p.textContent);
    expect(text.indexOf(requirementText(milestoner, 3))).toBeLessThan(text.indexOf(`"${tierFlavor(milestoner, 3)}"`));
    expect(text.indexOf(`"${tierFlavor(milestoner, 3)}"`)).toBeLessThan(text.indexOf('Held by 5 of 6 in your pack'));
  });

  it('ingen Next-rad, ingen "TOP TIER REACHED" och ingen global siffra (kompakt, O2)', async () => {
    render(<BadgeEmblemDetail row={rowOf(collection([]), streakKeeper.key)} />);
    const dialog = await open(`Legendary ${streakKeeper.name}`);
    expect(within(dialog).queryByText(/^Next:/)).toBeNull();
    expect(within(dialog).queryByText(/TOP TIER/)).toBeNull();
    expect(dialog.textContent).not.toMatch(/globally|%|has it/i);
  });

  it('mitt eget ensamma kort: "Only you hold this in your pack"', async () => {
    render(<BadgeEmblemDetail row={rowOf(collection([]), streakKeeper.key)} />);
    const dialog = await open(`Legendary ${streakKeeper.name}`);
    expect(within(dialog).getByText('Only you hold this in your pack')).toBeInTheDocument();
  });

  it('held-by följer modellens regler: göms på någon annans kort när alla har den (X = N)', async () => {
    const row = rowOf(collection([], OTHER), earthTrotter.key);
    expect(row.heldBy).toBeUndefined();
    render(<BadgeEmblemDetail row={row} />);
    const dialog = await open(`Uncommon ${earthTrotter.name}`);
    expect(within(dialog).queryByText(/in your pack/)).toBeNull();
  });

  it('held-by utelämnas utan platshållare när gruppen felar', async () => {
    render(<BadgeEmblemDetail row={rowOf(collection([], ME, null), milestoner.key)} />);
    const dialog = await open(`Rare ${milestoner.name}`);
    expect(within(dialog).queryByText(/in your pack/)).toBeNull();
    expect(dialog.textContent).not.toMatch(/undefined|null/);
  });

  it('"On display" visas bara för en intjänad serie i det sparade valet', async () => {
    const shown = render(<BadgeEmblemDetail row={rowOf(collection([milestoner.key]), milestoner.key)} />);
    expect(within(await open(`Rare ${milestoner.name}`)).getByText('On display')).toBeInTheDocument();
    shown.unmount();

    render(<BadgeEmblemDetail row={rowOf(collection([milestoner.key]), climber.key)} />);
    expect(within(await open(`Common ${climber.name}`)).queryByText('On display')).toBeNull();
  });

  it('en rad som är sparad men inte längre intjänad får aldrig "On display"', async () => {
    const stale: BadgeRow = { ...rowOf(collection([]), nightOwl.key), displayPosition: 1 };
    render(<BadgeEmblemDetail row={stale} />);
    expect(within(await open(`Locked ${nightOwl.name}`)).queryByText('On display')).toBeNull();
  });
});

describe('BadgeEmblemDetail — popovern, låst serie (Council 1)', () => {
  it('Locked-chip, måttetiketten och "Unlock: Common — …"; ingen flavor, ingen held-by, inga nivåpips att läsa', async () => {
    render(<BadgeEmblemDetail row={rowOf(collection([]), nightOwl.key)} />);
    const dialog = await open(`Locked ${nightOwl.name}`);
    const view = within(dialog);
    expect(HELD.holders[nightOwl.key]['1']).toBeGreaterThan(0);
    expect(dialog).toHaveAccessibleName(nightOwl.name);
    expect(view.getByText('Locked', { selector: '.rq-chip' })).toBeInTheDocument();
    expect(view.getByText(nightOwl.metricLabel)).toBeInTheDocument();
    expect(view.getByText(`Unlock: Common — ${requirementText(nightOwl, 1)}`)).toBeInTheDocument();
    expect(dialog.querySelector('.rq-badge-card__flavor, .rq-badge-detail__flavor')).toBeNull();
    expect(view.queryByText(/in your pack/)).toBeNull();
    expect(view.queryByRole('img', { name: /Tier/ })).toBeNull();
  });
});

describe('BadgeEmblemDetail — öppna och stänga (F10.4)', () => {
  it('fokus flyttar in i popovern vid öppning', async () => {
    render(<BadgeEmblemDetail row={rowOf(collection([]), milestoner.key)} />);
    const dialog = await open(`Rare ${milestoner.name}`);
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('Escape stänger och fokus går tillbaka till knappen', async () => {
    render(<BadgeEmblemDetail row={rowOf(collection([]), milestoner.key)} />);
    const button = trigger(`Rare ${milestoner.name}`);
    const dialog = await open(`Rare ${milestoner.name}`);
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('ett nytt tryck på knappen stänger', async () => {
    render(<BadgeEmblemDetail row={rowOf(collection([]), milestoner.key)} />);
    await open(`Rare ${milestoner.name}`);
    fireEvent.click(trigger(`Rare ${milestoner.name}`));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('tryck utanför stänger', async () => {
    render(
      <>
        <BadgeEmblemDetail row={rowOf(collection([]), milestoner.key)} />
        <button type="button">elsewhere</button>
      </>,
    );
    await open(`Rare ${milestoner.name}`);
    // Radix lyssnar på pointerdown på dokumentet först efter en tick.
    await new Promise((resolve) => setTimeout(resolve, 5));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'elsewhere' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('en öppen popover åt gången: att trycka på ett annat emblem stänger det första', async () => {
    const rows = collection([]);
    render(
      <>
        <BadgeEmblemDetail row={rowOf(rows, milestoner.key)} />
        <BadgeEmblemDetail row={rowOf(rows, climber.key)} />
      </>,
    );
    await open(`Rare ${milestoner.name}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = trigger(`Common ${climber.name}`);
    fireEvent.pointerDown(second);
    fireEvent.click(second);
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    expect(screen.getByRole('dialog')).toHaveAccessibleName(climber.name);
  });
});
