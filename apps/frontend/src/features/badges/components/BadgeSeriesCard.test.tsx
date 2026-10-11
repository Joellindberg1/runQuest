import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { BADGE_SERIES, MAX_SHOWCASE, MAX_TIER, TIER_NAMES, requirementText, tierFlavor } from '@runquest/shared';
import type { BadgeUserItem } from '@runquest/shared';
import type { GroupBadges } from '../api';
import { buildCollection, type BadgeRow } from '../badgeModel';
import { BadgeSeriesCard, type ShowcaseToggle } from './BadgeSeriesCard';

// Det liggande kortet på badges-sidan (spec F9.5, F9.6, Council 1, 2, 17): innehåll per läge och växlaren (Show / On display — N / fullt / sparar / låst).
// Beteende och tillgänglighet, inte utseende. Texterna räknas fram ur shared — inga serienamn skrivs som strängar här.

const [milestoner, earthTrotter, climber, streakKeeper, , nightOwl] = BADGE_SERIES;
const ME = { viewerId: 'u-me', ownerId: 'u-me' };
const LIMIT_ID = 'badge-limit';
const LIMIT_TEXT = `${MAX_SHOWCASE} of ${MAX_SHOWCASE} on display — remove one first.`;

const item = (series: string, tier: number): BadgeUserItem => ({ series, tier, earned_at: '2026-10-01T12:00:00Z', seen_tier: tier });
function group(held: Record<string, number>, memberCount = 6): GroupBadges {
  const holders: GroupBadges['holders'] = {};
  for (const series of BADGE_SERIES) {
    holders[series.key] = {};
    for (let tier = 1; tier <= MAX_TIER; tier += 1) holders[series.key][String(tier)] = held[series.key] ?? 0;
  }
  return { members: [], holders, member_count: memberCount };
}
// Även den låsta serien har tal i rutnätet: det får ändå aldrig visas (Council 1).
const HELD = group({ [milestoner.key]: 5, [earthTrotter.key]: 6, [climber.key]: 4, [streakKeeper.key]: 1, [nightOwl.key]: 3 });
const rows = buildCollection(
  { items: [item(milestoner.key, 3), item(earthTrotter.key, 2), item(climber.key, 1), item(streakKeeper.key, MAX_TIER)], showcase: [] },
  HELD,
  ME,
);
const rowOf = (series: string) => rows.find((row) => row.series === series) as BadgeRow;

const idle = (overrides: Partial<ShowcaseToggle> = {}): ShowcaseToggle => ({ position: null, full: false, saving: false, limitId: LIMIT_ID, onToggle: vi.fn(), ...overrides });
function renderCard(row: BadgeRow, toggle: ShowcaseToggle = idle()) {
  return render(
    <>
      <p id={LIMIT_ID}>{LIMIT_TEXT}</p>
      <ul>
        <BadgeSeriesCard row={row} layout="landscape" toggle={toggle} />
      </ul>
    </>,
  );
}
const card = () => screen.getByRole('listitem');

describe('BadgeSeriesCard liggande — intjänat kort (F9.5)', () => {
  it('serienamnet som <h3>, emblem (dekorativt), nivåchip och pips "Tier N of 6"', () => {
    renderCard(rowOf(milestoner.key));
    expect(within(card()).getByRole('heading', { level: 3, name: milestoner.name })).toBeInTheDocument();
    expect(within(card()).getByText('Rare')).toHaveAttribute('data-tier', 'rare');
    expect(within(card()).getByRole('img', { name: 'Tier 3 of 6' })).toBeInTheDocument();
    const emblem = card().querySelector('.rq-badge--md');
    expect(emblem).toHaveAttribute('aria-hidden', 'true');
  });

  it('kravtexten utan nivåprefix, flavor på egen rad (citerad), Next-raden och held-by', () => {
    renderCard(rowOf(milestoner.key));
    const req = within(card()).getByText(requirementText(milestoner, 3));
    expect(req.textContent?.startsWith('Rare')).toBe(false);
    const flavor = within(card()).getByText(`"${tierFlavor(milestoner, 3)}"`);
    expect(flavor.tagName).toBe('P');
    expect(flavor).not.toBe(req);
    expect(within(card()).getByText(`Next: ${TIER_NAMES[3]} — ${requirementText(milestoner, 4)}`)).toBeInTheDocument();
    expect(within(card()).getByText('Held by 5 of 6 in your pack')).toBeInTheDocument();
  });

  it('mitt eget ensamma kort: "Only you hold this in your pack"', () => {
    renderCard(rowOf(streakKeeper.key));
    expect(within(card()).getByText('Only you hold this in your pack')).toBeInTheDocument();
  });

  it('maxad serie: "TOP TIER REACHED" i stället för Next', () => {
    renderCard(rowOf(streakKeeper.key));
    expect(within(card()).getByText('TOP TIER REACHED')).toBeInTheDocument();
    expect(within(card()).queryByText(/^Next:/)).toBeNull();
  });

  it('held-by utelämnas utan platshållare när gruppdata saknas (gruppen felar)', () => {
    const noGroup = buildCollection({ items: [item(milestoner.key, 3)], showcase: [] }, undefined, ME)[0];
    renderCard(noGroup);
    expect(within(card()).queryByText(/in your pack/)).toBeNull();
    expect(card().textContent).not.toMatch(/undefined|null/);
  });

  it('DOM-ordning för rutnätsområdena: emblem, who (namn, chip, pips), body (krav, flavor, Next, held-by + växlare)', () => {
    renderCard(rowOf(milestoner.key));
    const [emblem, who, body] = Array.from(card().children);
    expect(emblem.querySelector('.rq-badge')).not.toBeNull();
    expect(within(who as HTMLElement).getByRole('heading')).toBeInTheDocument();
    expect(who.querySelector('.rq-badge-pips')).not.toBeNull();
    expect(card().children).toHaveLength(3);
    const paragraphs = Array.from(body.querySelectorAll('p')).map((p) => p.textContent);
    expect(paragraphs[0]).toBe(requirementText(milestoner, 3));
    expect(paragraphs[1]).toBe(`"${tierFlavor(milestoner, 3)}"`);
    expect(paragraphs[2]).toMatch(/^Next:/);
    expect(body.lastElementChild?.contains(screen.getByRole('button'))).toBe(true);
  });
});

describe('BadgeSeriesCard liggande — låst kort (Council 1)', () => {
  it('streckad (data-state locked), Locked-chip, dekorativa tomma pips, måttetiketten och "Unlock: Common — …"', () => {
    renderCard(rowOf(nightOwl.key));
    expect(card()).toHaveAttribute('data-state', 'locked');
    expect(within(card()).getByText('Locked', { selector: '.rq-chip' })).toBeInTheDocument();
    expect(within(card()).queryByRole('img', { name: /Tier/ })).toBeNull();
    expect(within(card()).getByText(nightOwl.metricLabel)).toBeInTheDocument();
    expect(within(card()).getByText(`Unlock: Common — ${requirementText(nightOwl, 1)}`)).toBeInTheDocument();
  });

  it('aldrig held-by, flavor eller Next — även när gruppen har tal för serien', () => {
    renderCard(rowOf(nightOwl.key));
    expect(HELD.holders[nightOwl.key]['1']).toBeGreaterThan(0);
    expect(card().querySelector('.rq-badge-card__held')).toBeNull();
    expect(card().querySelector('.rq-badge-card__flavor')).toBeNull();
    expect(within(card()).queryByText(/^Next:/)).toBeNull();
    expect(within(card()).queryByText(/in your pack/)).toBeNull();
  });

  it('försvar på komponentnivå: en handgjord låst rad med heldBy, flavor och next visar ingen av dem (liggande och stående)', () => {
    const forged: BadgeRow = { ...rowOf(nightOwl.key), heldBy: 'Held by 3 of 6 in your pack', flavor: 'Forged flavor', next: 'Next: Forged — nothing', maxed: false };
    expect(forged.earned).toBe(false);
    const view = renderCard(forged);
    for (const text of ['Held by 3 of 6 in your pack', '"Forged flavor"', 'Next: Forged — nothing']) expect(within(card()).queryByText(text), text).toBeNull();
    view.unmount();
    render(<ul><BadgeSeriesCard row={forged} /></ul>);
    for (const text of ['Held by 3 of 6 in your pack', '"Forged flavor"', 'Next: Forged — nothing']) expect(screen.queryByText(text), text).toBeNull();
  });

  it('växlaren är ingen knapp: en aria-hidden "Locked"-ruta', () => {
    renderCard(rowOf(nightOwl.key));
    expect(within(card()).queryByRole('button')).toBeNull();
    const box = card().querySelector('.rq-badge-toggle');
    expect(box?.tagName).toBe('SPAN');
    expect(box).toHaveAttribute('aria-hidden', 'true');
    expect(box).toHaveTextContent('Locked');
    expect(card()).not.toHaveAttribute('data-display');
  });
});

describe('BadgeSeriesCard liggande — växlaren (F9.6)', () => {
  it('Show: <button type="button" aria-pressed="false"> med osynlig serieprefix i namnet, ett klick kallar onToggle', () => {
    const toggle = idle();
    renderCard(rowOf(climber.key), toggle);
    const button = screen.getByRole('button', { name: `${climber.name}: Show` });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).not.toHaveAttribute('aria-describedby');
    expect(button).toHaveTextContent('Show');
    fireEvent.click(button);
    expect(toggle.onToggle).toHaveBeenCalledTimes(1);
    expect(card()).not.toHaveAttribute('data-display');
  });

  it('On display — N: aria-pressed="true", platsen i texten, kortet får data-display="true", klick kallar onToggle (ta bort)', () => {
    const toggle = idle({ position: 2 });
    renderCard(rowOf(climber.key), toggle);
    const button = screen.getByRole('button', { name: `${climber.name}: On display — 2` });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveTextContent('On display — 2');
    expect(card()).toHaveAttribute('data-display', 'true');
    fireEvent.click(button);
    expect(toggle.onToggle).toHaveBeenCalledTimes(1);
  });

  it('fullt (3/3): aria-disabled + aria-describedby mot den synliga meningen, texten kvar "Show", klicket ignoreras, kvar i tabbordningen', () => {
    const toggle = idle({ full: true });
    renderCard(rowOf(climber.key), toggle);
    const button = screen.getByRole('button', { name: `${climber.name}: Show` });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('aria-describedby', LIMIT_ID);
    expect(button).toHaveAccessibleDescription(LIMIT_TEXT);
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute('tabindex', '-1');
    expect(screen.getByText(LIMIT_TEXT)).toBeVisible();
    fireEvent.click(button);
    expect(toggle.onToggle).not.toHaveBeenCalled();
    button.focus();
    expect(button).toHaveFocus();
  });

  it('fullt: en redan vald växlare är inte avstängd — den kan tas bort', () => {
    const toggle = idle({ full: true, position: 1 });
    renderCard(rowOf(climber.key), toggle);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).not.toHaveAttribute('aria-describedby');
    fireEvent.click(button);
    expect(toggle.onToggle).toHaveBeenCalledTimes(1);
  });

  it('fullt dimmar knappen, aldrig kortet: ingen opacity eller style på kortet eller texterna', () => {
    renderCard(rowOf(climber.key), idle({ full: true }));
    for (const element of [card(), ...Array.from(card().querySelectorAll('*'))]) expect(element.getAttribute('style')).toBeNull();
    expect(card()).not.toHaveAttribute('aria-disabled');
    expect(card()).not.toHaveAttribute('inert');
  });

  it('sparar: alla växlare aria-disabled och klick ignoreras — även den valda, som behåller aria-pressed="true"', () => {
    const picked = idle({ saving: true, position: 3 });
    const { unmount } = renderCard(rowOf(climber.key), picked);
    const selected = screen.getByRole('button');
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    expect(selected).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(selected);
    expect(picked.onToggle).not.toHaveBeenCalled();
    unmount();

    const other = idle({ saving: true });
    renderCard(rowOf(climber.key), other);
    const unselected = screen.getByRole('button');
    expect(unselected).toHaveAttribute('aria-pressed', 'false');
    expect(unselected).toHaveAttribute('aria-disabled', 'true');
    expect(unselected).not.toHaveAttribute('aria-describedby');
    fireEvent.click(unselected);
    expect(other.onToggle).not.toHaveBeenCalled();
  });

  it('sparar medan utkastet är fullt: avstängd med förklaringen kopplad', () => {
    renderCard(rowOf(climber.key), idle({ saving: true, full: true }));
    expect(screen.getByRole('button')).toHaveAttribute('aria-describedby', LIMIT_ID);
  });

  it('knappen är samma element när läget växlar, så fokus ligger kvar (elementet avmonteras inte)', () => {
    const toggle = idle();
    const view = renderCard(rowOf(climber.key), toggle);
    const button = screen.getByRole('button');
    button.focus();
    view.rerender(
      <>
        <p id={LIMIT_ID}>{LIMIT_TEXT}</p>
        <ul>
          <BadgeSeriesCard row={rowOf(climber.key)} layout="landscape" toggle={{ ...toggle, position: 1 }} />
        </ul>
      </>,
    );
    expect(screen.getByRole('button')).toBe(button);
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('kortets enda interaktiva element är växlaren', () => {
    renderCard(rowOf(milestoner.key));
    expect(within(card()).getAllByRole('button')).toHaveLength(1);
    expect(within(card()).queryByRole('link')).toBeNull();
    expect(card()).not.toHaveAttribute('tabindex');
    expect(card()).not.toHaveAttribute('onclick');
  });
});

describe('BadgeSeriesCard — ingen global procent och ingen "has it" (O2, F9.12)', () => {
  const states: Array<[string, BadgeRow, ShowcaseToggle]> = [
    ['intjänat', rowOf(milestoner.key), idle()],
    ['vald', rowOf(milestoner.key), idle({ position: 1 })],
    ['fullt', rowOf(climber.key), idle({ full: true })],
    ['maxat', rowOf(streakKeeper.key), idle()],
    ['låst', rowOf(nightOwl.key), idle()],
  ];
  it.each(states)('%s: ingen "globally", "%", "has it" eller "in pack" utan "your"', (_name, row, toggle) => {
    renderCard(row, toggle);
    const text = card().textContent ?? '';
    expect(text).not.toMatch(/globally|%|has it/i);
    expect(text).not.toMatch(/in pack/i);
  });
});

describe('BadgeSeriesCard — det stående kortet är oförändrat (BadgeCollection)', () => {
  it('utan layout ritas det som förut: ingen växlare, ingen liggande modifierare, id-blocket med emblem + namn', () => {
    render(
      <ul>
        <BadgeSeriesCard row={rowOf(milestoner.key)} />
      </ul>,
    );
    const stacked = screen.getByRole('listitem');
    expect(stacked).toHaveClass('rq-badge-card');
    expect(stacked).not.toHaveClass('rq-badge-card--landscape');
    expect(stacked.querySelector('.rq-badge-card__id')).not.toBeNull();
    expect(within(stacked).queryByRole('button')).toBeNull();
    expect(stacked.querySelector('.rq-badge-toggle')).toBeNull();
  });
});
