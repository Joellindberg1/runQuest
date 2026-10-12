import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { BADGE_SERIES, MAX_TIER, TIER_NAMES } from '@runquest/shared';
import BadgesPreviewPage from './BadgesPreviewPage';

// /preview/badges ritar emblem-arket (F1) med de riktiga komponenterna, utan inloggning och utan backend.

describe('/preview/badges', () => {
  it('visar rubrik och sex nivåkort med chip, pips och emblem för varje nivå', () => {
    render(<BadgesPreviewPage />);
    expect(screen.getByRole('heading', { name: 'BADGES', level: 1 })).toBeInTheDocument();
    const tiers = within(screen.getByRole('region', { name: /^six tiers/i })).getAllByRole('listitem');
    expect(tiers).toHaveLength(MAX_TIER);
    tiers.forEach((card, index) => {
      expect(within(card).getByText(TIER_NAMES[index])).toBeInTheDocument();
      expect(within(card).getByRole('img', { name: `Tier ${index + 1} of ${MAX_TIER}` })).toBeInTheDocument();
      expect(within(card).getByRole('img', { name: new RegExp(`^${TIER_NAMES[index]} `) })).toBeInTheDocument();
    });
  });

  it('matrisen har en rad per serie och en cell per nivå', () => {
    render(<BadgesPreviewPage />);
    const matrix = screen.getByRole('table');
    const rows = within(matrix).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(BADGE_SERIES.length);
    for (const [index, series] of BADGE_SERIES.entries()) {
      expect(within(rows[index]).getByRole('rowheader', { name: series.name })).toBeInTheDocument();
      expect(within(rows[index]).getAllByRole('img')).toHaveLength(MAX_TIER);
    }
  });

  it('låsta serier ritas som låsta: "Locked {serie}"', () => {
    render(<BadgesPreviewPage />);
    const locked = within(screen.getByRole('region', { name: /^locked/i }));
    for (const series of BADGE_SERIES) expect(locked.getByRole('img', { name: `Locked ${series.name}` })).toBeInTheDocument();
  });

  it('Heroic-kontrollen jämför Uncommon och Heroic vid mini (färg och gråskala)', () => {
    render(<BadgesPreviewPage />);
    const check = within(screen.getByRole('region', { name: /heroic ring at mini/i }));
    expect(check.getAllByRole('img', { name: new RegExp(`^${TIER_NAMES[1]} `) }).length).toBeGreaterThanOrEqual(2);
    expect(check.getAllByRole('img', { name: new RegExp(`^${TIER_NAMES[3]} `) }).length).toBeGreaterThanOrEqual(2);
  });

  it('storleksraderna visar alla fyra storlekarna (sm, cp, md, lg) med sex nivåer var — cp är den nya 44 px-storleken', () => {
    render(<BadgesPreviewPage />);
    const sizes = within(screen.getByRole('region', { name: /^sizes/i }));
    for (const size of ['sm', 'cp', 'md', 'lg']) {
      const row = sizes.getAllByRole('img').filter((emblem) => emblem.classList.contains(`rq-badge--${size}`));
      expect(row, size).toHaveLength(MAX_TIER);
    }
    expect(sizes.getByText(/44 PX/)).toBeInTheDocument();
  });

  it('kontrollytan visar ett nivåchip per nivå på en kortyta (.rq-card + .rq-badge-card) för kontrastmätning', () => {
    render(<BadgesPreviewPage />);
    const region = screen.getByRole('region', { name: /^tier chips on a collection card/i });
    const surface = region.querySelector('.rq-card .rq-badge-card');
    expect(surface).not.toBeNull();
    for (const name of TIER_NAMES) expect(within(surface as HTMLElement).getByText(name)).toHaveAttribute('data-tier', name.toLowerCase());
  });

  it('Replay monterar om tändningsraden (animationer startar när elementet monteras)', () => {
    render(<BadgesPreviewPage />);
    const motion = () => screen.getByRole('region', { name: /^motion/i });
    const before = motion().querySelector('.rq-badge--ignite');
    expect(before).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    const after = motion().querySelector('.rq-badge--ignite');
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it('byggstenarna: varje växlarläge finns som kort — Show, On display — N, fullt, sparar (vald och icke vald) och låst', () => {
    render(<BadgesPreviewPage />);
    const modes = within(screen.getByRole('region', { name: /^landscape card · every toggle mode/i }));
    const buttons = modes.getAllByRole('button');
    const pressed = (value: string) => buttons.filter((button) => button.getAttribute('aria-pressed') === value);
    expect(buttons.some((button) => button.textContent?.endsWith('Show') && !button.hasAttribute('aria-disabled'))).toBe(true);
    expect(buttons.some((button) => /On display — 2$/.test(button.textContent ?? ''))).toBe(true);
    expect(pressed('false').some((button) => button.getAttribute('aria-disabled') === 'true' && button.hasAttribute('aria-describedby'))).toBe(true);
    expect(pressed('true').some((button) => button.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(pressed('false').filter((button) => button.getAttribute('aria-disabled') === 'true').length).toBeGreaterThanOrEqual(2);
    expect(modes.getAllByText('Locked', { selector: '.rq-badge-toggle' }).length).toBeGreaterThanOrEqual(1);
  });

  it('det levande utkastet: ett klick väljer, tre valda gör övriga avstängda med den synliga meningen, Simulate saving stänger av alla', () => {
    render(<BadgesPreviewPage />);
    const live = within(screen.getByRole('region', { name: /^landscape cards · live draft/i }));
    const switches = () => live.getAllByRole('button').filter((button) => button.hasAttribute('data-series'));
    const show = () => switches().filter((button) => button.getAttribute('aria-pressed') === 'false');
    expect(live.queryByText(/of 3 on display — remove one first/)).toBeNull();
    fireEvent.click(show()[0]);
    expect(live.getByText('3 of 3 on display — remove one first.')).toBeInTheDocument();
    expect(show().every((button) => button.getAttribute('aria-disabled') === 'true' && button.getAttribute('aria-describedby'))).toBe(true);

    fireEvent.click(live.getByRole('button', { name: /simulate saving/i }));
    expect(switches().every((button) => button.getAttribute('aria-disabled') === 'true')).toBe(true);
  });

  it('emblemknapparna: intjänade sorterade på nivå (buildBadgeSummary) och låsta separat, varje öppnar en popover', async () => {
    render(<BadgesPreviewPage />);
    const region = within(screen.getByRole('region', { name: /^emblem detail/i }));
    const earned = within(region.getByRole('list', { name: 'Earned badges' })).getAllByRole('button');
    const locked = within(region.getByRole('list', { name: 'Locked badges' })).getAllByRole('button');
    const tiers = earned.map((button) => TIER_NAMES.findIndex((name) => (button.getAttribute('aria-label') ?? '').startsWith(`${name} `)));
    expect(tiers).toEqual([...tiers].sort((a, b) => b - a));
    expect(earned.length + locked.length).toBe(BADGE_SERIES.length);
    expect(locked.every((button) => button.getAttribute('aria-label')?.startsWith('Locked '))).toBe(true);
    fireEvent.click(earned[0]);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('badge-minis på panelen är dekorativa med en gemensam etikett', () => {
    render(<BadgesPreviewPage />);
    const group = screen.getByRole('img', { name: /^Badges: / });
    expect(group.querySelectorAll('.rq-badge')).toHaveLength(3);
    for (const badge of group.querySelectorAll('.rq-badge')) expect(badge).toHaveAttribute('aria-hidden', 'true');
  });
});
