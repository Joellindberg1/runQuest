import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { BADGE_SERIES, MAX_TIER, TIER_NAMES, requirementText, tierFlavor } from '@runquest/shared';
import type { BadgeUserItem, BadgeUserResponse } from '@runquest/shared';
import type { GroupBadges } from '../api';
import { buildCollection } from '../badgeModel';
import { BadgeCollection } from './BadgeCollection';

// BADGES-kortet i profilen (RUN-128, spec F2/F8, Council 1, 2, 9, 14): ett kort per serie i serielistans ordning, intjänade/låsta/maxade kort, ON DISPLAY-remsan,
// och tillstånden skelett, tomt och fel. Texterna räknas fram ur shared — inga serienamn skrivs som strängar här.

const [milestoner, earthTrotter, climber, streakKeeper, earlyBird, nightOwl, speedster, precisionist] = BADGE_SERIES;
const ME = { viewerId: 'u-me', ownerId: 'u-me' };

const item = (series: string, tier: number): BadgeUserItem => ({ series, tier, earned_at: '2026-10-01T12:00:00Z', seen_tier: tier });
// Som F2: fem serier intjänade (en maxad), tre låsta; tre visade i en annan ordning än serielistans.
const DATA: BadgeUserResponse = {
  items: [item(milestoner.key, 3), item(earthTrotter.key, 2), item(climber.key, 1), item(streakKeeper.key, MAX_TIER), item(earlyBird.key, 4)],
  showcase: [streakKeeper.key, earlyBird.key, milestoner.key],
};

function group(held: Record<string, number>, memberCount = 6): GroupBadges {
  const holders: GroupBadges['holders'] = {};
  for (const series of BADGE_SERIES) {
    holders[series.key] = {};
    for (let tier = 1; tier <= MAX_TIER; tier += 1) holders[series.key][String(tier)] = held[series.key] ?? 0;
  }
  return { members: [], holders, member_count: memberCount };
}
// Även låsta serier har tal i rutnätet: de får ändå aldrig visas (Council 1).
const HELD = group({ [milestoner.key]: 5, [earthTrotter.key]: 6, [climber.key]: 4, [streakKeeper.key]: 1, [earlyBird.key]: 2, [nightOwl.key]: 3, [speedster.key]: 1 });

const rowsFor = (data: BadgeUserResponse | undefined, grid: GroupBadges | undefined) => buildCollection(data, grid, ME);
const renderCollection = (props: Partial<Parameters<typeof BadgeCollection>[0]> = {}) => render(<BadgeCollection rows={rowsFor(DATA, HELD)} isDesktop={false} {...props} />);
const cards = () => within(screen.getByRole('list', { name: 'Badge series' })).getAllByRole('listitem');
const cardOf = (name: string) => cards().find((card) => within(card).queryByRole('heading', { name })) as HTMLElement;

describe('BadgeCollection — rubrik, remsa och rutnät', () => {
  it('rubriken BADGES och räknaren "N of 8 series" (N = intjänade serier)', () => {
    renderCollection();
    expect(screen.getByRole('heading', { level: 2, name: 'BADGES' })).toBeInTheDocument();
    expect(screen.getByText(`5 of ${BADGE_SERIES.length} series`)).toBeInTheDocument();
  });

  it('ett kort per serie i serielistans ordning (låsta också)', () => {
    renderCollection();
    expect(cards()).toHaveLength(BADGE_SERIES.length);
    expect(cards().map((card) => within(card).getByRole('heading').textContent)).toEqual(BADGE_SERIES.map((series) => series.name));
  });

  it('ON DISPLAY-remsan visar de valda i användarens ordning (minis med nivå + serie i etiketten)', () => {
    renderCollection();
    expect(screen.getByText('On display')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: `Badges: ${TIER_NAMES[MAX_TIER - 1]} ${streakKeeper.name}, ${TIER_NAMES[3]} ${earlyBird.name}, ${TIER_NAMES[2]} ${milestoner.name}` })).toBeInTheDocument();
  });

  it('desktop visar dessutom namnen i remsan; mobil visar bara minisen', () => {
    const { unmount } = renderCollection({ isDesktop: true });
    expect(screen.getByText(`${streakKeeper.name} · ${earlyBird.name} · ${milestoner.name}`)).toBeInTheDocument();
    unmount();
    renderCollection({ isDesktop: false });
    expect(screen.queryByText(/·/)).toBeNull();
  });

  it('ingen Edit-knapp i RUN-128 (byggs i RUN-129): inga knappar alls i kortet', () => {
    renderCollection({ isDesktop: true });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/^edit/i)).toBeNull();
  });

  it('inga valda badges: ingen tom remsa och ingen platshållare', () => {
    renderCollection({ rows: rowsFor({ ...DATA, showcase: [] }, HELD) });
    expect(screen.queryByText('On display')).toBeNull();
    expect(screen.queryByRole('img', { name: /^Badges:/ })).toBeNull();
    expect(cards()).toHaveLength(BADGE_SERIES.length);
  });

  it('ingen text matchar /% of/ (ingen percentil, Council 1) och ingen "undefined"/"null"', () => {
    renderCollection({ isDesktop: true });
    expect(document.body.textContent).not.toMatch(/% of/);
    expect(document.body.textContent).not.toMatch(/undefined|null|NaN/);
  });
});

describe('BadgeSeriesCard — intjänat kort', () => {
  it('visar serienamn, tiernamn (chip), pips-text, kravtext utan nivåprefix och flavor på egen rad', () => {
    renderCollection();
    const card = cardOf(milestoner.name);
    expect(card).toHaveAttribute('data-state', 'earned');
    expect(within(card).getByText(TIER_NAMES[2])).toHaveAttribute('data-tier', 'rare');
    expect(within(card).getByRole('img', { name: 'Tier 3 of 6' })).toBeInTheDocument();
    const requirement = within(card).getByText(requirementText(milestoner, 3));
    expect(requirement.textContent).not.toMatch(new RegExp(`^${TIER_NAMES[2]}`));
    // Flavor: citerad, en egen rad (eget stycke), inte inbakad i kravtexten.
    const flavor = within(card).getByText(`"${tierFlavor(milestoner, 3)}"`);
    expect(flavor).not.toBe(requirement);
    expect(requirement.textContent).not.toContain(tierFlavor(milestoner, 3));
    expect(flavor).toHaveClass('rq-badge-card__flavor');
  });

  it('visar "Next: {Nästa nivå} — {krav}" utan flavor och held-by ur gruppens holders', () => {
    renderCollection();
    const card = cardOf(milestoner.name);
    expect(within(card).getByText(`Next: ${TIER_NAMES[3]} — ${requirementText(milestoner, 4)}`)).toBeInTheDocument();
    expect(within(card).getByText('Held by 5 of 6 in your pack')).toBeInTheDocument();
    expect(within(card).queryByText('TOP TIER REACHED')).toBeNull();
  });

  it('upplåst serie visar tiernamn och held-by (på mitt eget kort visas också X = N)', () => {
    renderCollection();
    const card = cardOf(earthTrotter.name);
    expect(within(card).getByText(TIER_NAMES[1])).toBeInTheDocument();
    expect(within(card).getByText('Held by 6 of 6 in your pack')).toBeInTheDocument();
  });

  it('maxad serie visar TOP TIER REACHED och inget Next; X = 1 på mitt kort blir "Only you hold this in your pack"', () => {
    renderCollection();
    const card = cardOf(streakKeeper.name);
    expect(within(card).getByText(TIER_NAMES[MAX_TIER - 1])).toHaveAttribute('data-tier', 'legendary');
    expect(within(card).getByText('TOP TIER REACHED')).toBeInTheDocument();
    expect(within(card).queryByText(/^Next:/)).toBeNull();
    expect(within(card).getByText('Only you hold this in your pack')).toBeInTheDocument();
    expect(within(card).getByText(`"${tierFlavor(streakKeeper, MAX_TIER)}"`)).toBeInTheDocument();
  });

  it('held-by utelämnas utan platshållare när gruppens data saknas (group-fel)', () => {
    renderCollection({ rows: rowsFor(DATA, undefined) });
    expect(screen.queryByText(/Held by|Only you hold/)).toBeNull();
    // Resten av kortet står kvar.
    expect(within(cardOf(milestoner.name)).getByText(requirementText(milestoner, 3))).toBeInTheDocument();
  });

  it('emblemet är dekorativt: kortet läses en gång (namn, nivå, krav)', () => {
    renderCollection();
    const card = cardOf(milestoner.name);
    expect(card.querySelector('.rq-badge')).toHaveAttribute('aria-hidden', 'true');
    expect(within(card).queryByRole('img', { name: new RegExp(`${milestoner.name}$`) })).toBeNull();
  });
});

describe('BadgeSeriesCard — låst kort', () => {
  it('låst serie visar måttetiketten och kravtexten för tier 1 ("Unlock: Common — …")', () => {
    renderCollection();
    const card = cardOf(nightOwl.name);
    expect(card).toHaveAttribute('data-state', 'locked');
    expect(within(card).getByText(nightOwl.metricLabel)).toBeInTheDocument();
    expect(within(card).getByText(`Unlock: ${TIER_NAMES[0]} — ${requirementText(nightOwl, 1)}`)).toBeInTheDocument();
  });

  it('låst chip använder bara .rq-chip (och texten Locked)', () => {
    renderCollection();
    const chip = within(cardOf(speedster.name)).getByText('Locked');
    expect(chip.className).toBe('rq-chip');
    expect(chip).not.toHaveAttribute('data-tier');
  });

  it('inget låst kort har held-by, flavor, Next eller pips-etikett — även när gruppen har tal för serien', () => {
    renderCollection();
    for (const series of [nightOwl, speedster, precisionist]) {
      const card = cardOf(series.name);
      expect(within(card).queryByText(/Held by|Only you hold/)).toBeNull();
      expect(within(card).queryByText(/^Next:/)).toBeNull();
      expect(within(card).queryByText(/^"/)).toBeNull();
      expect(within(card).queryByText('TOP TIER REACHED')).toBeNull();
      expect(within(card).queryByRole('img')).toBeNull();
    }
    // Kravtexten står en gång (i Unlock-raden), inte dubbelt.
    expect(screen.getAllByText(new RegExp(requirementText(nightOwl, 1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toHaveLength(1);
  });
});

describe('BadgeCollection — tillstånd (F8)', () => {
  it('skeleton: tre kort i en statusregion, ingen rutnät, rubriken står kvar', () => {
    const { container } = renderCollection({ rows: [], loading: true });
    expect(screen.getByRole('status')).toHaveTextContent('Loading badges');
    expect(container.querySelectorAll('.rq-badge-skel')).toHaveLength(3);
    expect(screen.queryByRole('list', { name: 'Badge series' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'BADGES' })).toBeInTheDocument();
    expect(screen.queryByText(/of \d+ series/)).toBeNull();
  });

  it('tomt läge utan badges: "No badges yet", uppmaningen och åtta låsta minis (inget rutnät)', () => {
    const { container } = renderCollection({ rows: rowsFor({ items: [], showcase: [] }, HELD) });
    expect(screen.getByRole('heading', { name: /^no badges yet$/i })).toBeInTheDocument();
    expect(screen.getByText('Log a run to start collecting.')).toBeInTheDocument();
    expect(container.querySelectorAll('.rq-badge-empty .rq-badge[data-tier="locked"]')).toHaveLength(BADGE_SERIES.length);
    expect(screen.getByRole('img', { name: `Locked badges: ${BADGE_SERIES.map((series) => series.name).join(', ')}` })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Badge series' })).toBeNull();
    expect(screen.getByText(`0 of ${BADGE_SERIES.length} series`)).toBeInTheDocument();
  });

  it('fel: rött kantkort "Couldn\'t load your badges" / "Your runs are safe." och Retry anropar onRetry', () => {
    const onRetry = vi.fn();
    renderCollection({ rows: rowsFor(undefined, undefined), error: { onRetry, retrying: false } });
    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { name: "Couldn't load your badges" })).toBeInTheDocument();
    expect(within(alert).getByText('Your runs are safe.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Badge series' })).toBeNull();
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('Retry är avstängd medan omhämtningen pågår', () => {
    renderCollection({ rows: [], error: { onRetry: vi.fn(), retrying: true } });
    expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled();
  });
});
