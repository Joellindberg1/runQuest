import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BADGE_SERIES, TIER_NAMES } from '@runquest/shared';
import type { BadgePopupEntry } from '../badgeModel';
import { BadgeUpgradeDialog, DISMISS_GUARD_MS, type BadgeUpgradeDialogProps } from './BadgeUpgradeDialog';

// Dubbelklicksskyddet räknar med Date.now(): bara Date är falsk (timers och waitFor är riktiga), och passGuard() går förbi skyddet för nästa avfärdande.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); });
afterEach(() => { vi.useRealTimers(); });
const passGuard = () => vi.setSystemTime(Date.now() + DISMISS_GUARD_MS + 1);

// Uppgraderingspopupen (RUN-132, spec F6, Council 4, 19–21): knapptexter, semantik, fokus, rörelseklasser. Dialogen är ren presentation —
// kön, väntan och "seen" testas i BadgeUpgradeHost.test.tsx.

const [first, second] = BADGE_SERIES;

const entry = (overrides: Partial<BadgePopupEntry> = {}): BadgePopupEntry => ({
  series: first.key, name: first.name, icon: first.icon, tier: 1, tierName: TIER_NAMES[0], kind: 'earned', fromTier: null, fromTierName: null,
  flavor: first.flavors[0], requirement: 'A single run of 5 km', ...overrides,
});
const evolved = (tier: number, fromTier: number, overrides: Partial<BadgePopupEntry> = {}) =>
  entry({ tier, tierName: TIER_NAMES[tier - 1], kind: 'evolved', fromTier, fromTierName: TIER_NAMES[fromTier - 1], ...overrides });

const renderDialog = (props: Partial<BadgeUpgradeDialogProps> = {}) => {
  const onDismiss = vi.fn();
  const onSkipAll = vi.fn();
  const view = render(<BadgeUpgradeDialog entry={entry()} position={1} total={1} onDismiss={onDismiss} onSkipAll={onSkipAll} {...props} />);
  return { ...view, onDismiss, onSkipAll };
};
const dialog = () => screen.getByRole('dialog');
const emblems = () => Array.from(dialog().querySelectorAll<HTMLElement>('.rq-badge'));

describe('BadgeUpgradeDialog: innehållet (F6)', () => {
  it('earned: eyebrow, ett lg-emblem med tändning, serienamn, chip, kravtext, flavor på egen rad — ingen nivårad', () => {
    renderDialog({ entry: entry({ tier: 3, tierName: TIER_NAMES[2] }) });

    expect(within(dialog()).getByText('Badge earned')).toBeInTheDocument();
    expect(emblems()).toHaveLength(1);
    expect(emblems()[0]).toHaveClass('rq-badge--lg', 'rq-badge--ignite');
    expect(emblems()[0]).toHaveAttribute('data-tier', TIER_NAMES[2].toLowerCase());
    expect(screen.getByRole('heading', { name: first.name })).toBeInTheDocument();
    expect(within(dialog()).getByText(TIER_NAMES[2], { selector: '.rq-chip' })).toBeInTheDocument();
    expect(within(dialog()).getByText('A single run of 5 km')).toBeInTheDocument();
    const flavor = within(dialog()).getByText(`“${first.flavors[0]}”`);
    expect(flavor.tagName).toBe('P');
    expect(flavor.textContent).toBe(`“${first.flavors[0]}”`);
    expect(dialog().querySelector('.rq-badge-popup__tierline')).toBeNull();
  });

  it('evolved: gammalt sm-emblem, pil, nytt lg-emblem och nivåraden "UNCOMMON → RARE" i den nya nivåns färg (data-tier)', () => {
    renderDialog({ entry: evolved(3, 2) });

    expect(within(dialog()).getByText('Badge evolved')).toBeInTheDocument();
    expect(emblems().map((el) => [el.classList.contains('rq-badge--sm'), el.classList.contains('rq-badge--lg'), el.dataset.tier])).toEqual([
      [true, false, TIER_NAMES[1].toLowerCase()],
      [false, true, TIER_NAMES[2].toLowerCase()],
    ]);
    const tierline = dialog().querySelector('.rq-badge-popup__tierline') as HTMLElement;
    expect(tierline.textContent).toBe(`${TIER_NAMES[1]} → ${TIER_NAMES[2]}`);
    expect(tierline).toHaveAttribute('data-tier', TIER_NAMES[2].toLowerCase());
    // Bara det nya lg-emblemet tänds; det gamla sm-emblemet är stilla.
    expect(emblems()[0]).not.toHaveClass('rq-badge--ignite');
    expect(emblems()[1]).toHaveClass('rq-badge--ignite');
  });

  it('Legendary: lg-emblemet är legendary och tänds (andningen efter tändningen ligger i CSS, 3 cykler, och är av under reduced-motion)', () => {
    renderDialog({ entry: evolved(6, 5) });

    expect(emblems()[1]).toHaveAttribute('data-tier', 'legendary');
    expect(emblems()[1]).toHaveClass('rq-badge--lg', 'rq-badge--ignite');
  });

  it('held-by visas som modellen skrivit den, och utelämnas utan platshållare när den saknas', () => {
    const { rerender, onDismiss, onSkipAll } = renderDialog({ entry: entry({ heldBy: 'Held by 4 of 6 in your pack' }) });
    expect(within(dialog()).getByText('Held by 4 of 6 in your pack')).toBeInTheDocument();

    rerender(<BadgeUpgradeDialog entry={entry({ heldBy: 'Only you hold this in your pack' })} position={1} total={1} onDismiss={onDismiss} onSkipAll={onSkipAll} />);
    expect(within(dialog()).getByText('Only you hold this in your pack')).toBeInTheDocument();

    rerender(<BadgeUpgradeDialog entry={entry()} position={1} total={1} onDismiss={onDismiss} onSkipAll={onSkipAll} />);
    expect(dialog().querySelector('.rq-badge-popup__held')).toBeNull();
    expect(dialog().textContent).not.toMatch(/undefined|null/);
  });

  it('knapptexterna är exakt "Got it" (ensam fylld guldknapp) och ✕ — ingen "View badges", ingen Skip all utan kö', () => {
    renderDialog();

    expect(within(dialog()).getAllByRole('button').map((button) => button.textContent)).toEqual(['✕', 'Got it']);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(dialog().querySelectorAll('.rq-btn--primary')).toHaveLength(1);
    expect(screen.queryByText(/view badges/i)).toBeNull();
  });

  it('i kön: "Got it" och "Skip all" (ghost) — "Skip all" försvinner på sista platsen, där den vore samma sak som Got it', () => {
    const { rerender, onDismiss, onSkipAll } = renderDialog({ position: 1, total: 3 });
    expect(within(dialog()).getAllByRole('button').map((button) => button.textContent)).toEqual(['✕', 'Got it', 'Skip all']);
    expect(screen.getByRole('button', { name: 'Skip all' })).toHaveClass('rq-btn--ghost');
    expect(dialog().querySelectorAll('.rq-btn--primary')).toHaveLength(1);
    expect(screen.queryByText(/view badges/i)).toBeNull();

    rerender(<BadgeUpgradeDialog entry={entry()} position={3} total={3} onDismiss={onDismiss} onSkipAll={onSkipAll} />);
    expect(screen.queryByRole('button', { name: 'Skip all' })).toBeNull();
  });

  it('knapptexten lovar ingen belöning: ingen XP-, reward- eller bonus-text någonstans i popupen', () => {
    renderDialog({ entry: evolved(4, 3, { heldBy: 'Held by 2 of 6 in your pack' }), position: 1, total: 3 });

    expect(dialog().textContent).not.toMatch(/XP|reward|bonus/i);
    for (const button of within(dialog()).getAllByRole('button')) expect(button.textContent).not.toMatch(/XP|reward|bonus/i);
  });

  it('"1 of 3" ligger i en aria-live="polite"-region och uppdateras när kön går vidare', () => {
    const { rerender, onDismiss, onSkipAll } = renderDialog({ position: 1, total: 3 });
    const live = within(dialog()).getByText('1 of 3');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(dialog().querySelector('.rq-badge-popup__eyebrow')?.textContent).toBe('Badge earned · 1 of 3');

    rerender(<BadgeUpgradeDialog entry={entry({ series: second.key, name: second.name })} position={2} total={3} onDismiss={onDismiss} onSkipAll={onSkipAll} />);
    // Samma element (live-regionen är kvar i DOM), så skärmläsaren annonserar ändringen.
    expect(live).toHaveTextContent('2 of 3');
  });

  it('ingen kö-räknare när bara en popup väntar', () => {
    renderDialog({ position: 1, total: 1 });
    expect(dialog().querySelector('[aria-live]')).toBeNull();
  });
});

describe('BadgeUpgradeDialog: semantik och fokus (Council 19)', () => {
  it('role=dialog, aria-modal=true och aria-labelledby pekar på serienamnet', () => {
    renderDialog();

    expect(dialog()).toHaveAttribute('aria-modal', 'true');
    const title = screen.getByRole('heading', { name: first.name });
    expect(dialog().getAttribute('aria-labelledby')).toBe(title.id);
    expect(screen.getByRole('dialog', { name: first.name })).toBe(dialog());
  });

  it('fokus flyttas till "Got it" vid öppning och tillbaka till det som hade fokus före, vid stängning', async () => {
    const Harness = () => {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>opener</button>
          {open && <BadgeUpgradeDialog entry={entry()} position={1} total={1} onDismiss={() => setOpen(false)} onSkipAll={() => setOpen(false)} />}
        </>
      );
    };
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    fireEvent.click(opener);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Got it' })).toHaveFocus());
    passGuard();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('fokus lämnas tillbaka utan att sidan scrollar (preventScroll)', async () => {
    const Harness = () => {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>opener</button>
          {open && <BadgeUpgradeDialog entry={entry()} position={1} total={1} onDismiss={() => setOpen(false)} onSkipAll={() => setOpen(false)} />}
        </>
      );
    };
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    const focus = vi.spyOn(opener, 'focus');
    fireEvent.click(opener);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Got it' })).toHaveFocus());
    passGuard();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(opener).toHaveFocus());
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('Escape är "Got it": onDismiss anropas (inte onSkipAll)', async () => {
    const { onDismiss, onSkipAll } = renderDialog({ total: 3 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Got it' })).toHaveFocus());

    passGuard();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Got it' }), { key: 'Escape' });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSkipAll).not.toHaveBeenCalled();
  });

  it('klick på scrimmen är "Got it"', async () => {
    const { onDismiss } = renderDialog();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });

    const scrim = document.querySelector('.rq-scrim') as HTMLElement;
    passGuard();
    fireEvent.pointerDown(scrim);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('✕ och "Got it" gör samma sak; "Skip all" anropar onSkipAll', () => {
    const { onDismiss, onSkipAll } = renderDialog({ position: 1, total: 3 });

    passGuard();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    passGuard();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onDismiss).toHaveBeenCalledTimes(2);

    passGuard();
    fireEvent.click(screen.getByRole('button', { name: 'Skip all' }));
    expect(onSkipAll).toHaveBeenCalledTimes(1);
  });
});

describe('BadgeUpgradeDialog: tändning en gång per popup (key = serie + tier)', () => {
  it('nästa badge i kön får ett nytt emblem-element (annars startar inte CSS-tändningen om); samma badge behåller sitt', () => {
    const { rerender, onDismiss, onSkipAll } = renderDialog({ entry: entry({ tier: 2, tierName: TIER_NAMES[1] }), total: 3 });
    const before = emblems()[0];

    rerender(<BadgeUpgradeDialog entry={entry({ tier: 2, tierName: TIER_NAMES[1], heldBy: 'Held by 2 of 6 in your pack' })} position={1} total={3} onDismiss={onDismiss} onSkipAll={onSkipAll} />);
    expect(emblems()[0]).toBe(before);

    rerender(<BadgeUpgradeDialog entry={entry({ series: second.key, name: second.name, tier: 2, tierName: TIER_NAMES[1] })} position={2} total={3} onDismiss={onDismiss} onSkipAll={onSkipAll} />);
    expect(emblems()[0]).not.toBe(before);
    expect(emblems()[0]).toHaveClass('rq-badge--ignite');
  });
});

describe('BadgeUpgradeDialog: skydd mot dubbelklick och hållna tangenter', () => {
  const guardMs = DISMISS_GUARD_MS;

  it('avfärdande strax efter att en post blivit aktuell ignoreras (Got it, ✕, Escape, scrim och Skip all) och går igenom efter skyddstiden', async () => {
    const { onDismiss, onSkipAll } = renderDialog({ position: 1, total: 3 });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip all' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Got it' }), { key: 'Escape' });
    fireEvent.pointerDown(document.querySelector('.rq-scrim') as HTMLElement);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onSkipAll).not.toHaveBeenCalled();

    vi.setSystemTime(Date.now() + guardMs + 1);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('skyddet startar om för varje ny post i kön', () => {
    const { rerender, onDismiss, onSkipAll } = renderDialog({ position: 1, total: 3 });
    passGuard();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    rerender(<BadgeUpgradeDialog entry={entry({ series: second.key, name: second.name })} position={2} total={3} onDismiss={onDismiss} onSkipAll={onSkipAll} />);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('ett andra klick i ett dubbelklick (event.detail > 1) avfärdar inte, inte ens efter skyddstiden', () => {
    const { onDismiss, onSkipAll } = renderDialog({ position: 1, total: 3 });
    passGuard();

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }), { detail: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }), { detail: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Skip all' }), { detail: 2 });

    expect(onDismiss).not.toHaveBeenCalled();
    expect(onSkipAll).not.toHaveBeenCalled();
  });

  it('en hållen tangent (repeat) avfärdar inte: Escape stängs inte av, och Enter på knapparna får ingen standardhandling (inget nytt klick)', async () => {
    const { onDismiss } = renderDialog({ position: 1, total: 3 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Got it' })).toHaveFocus());
    passGuard();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Got it' }), { key: 'Escape', repeat: true });
    expect(onDismiss).not.toHaveBeenCalled();

    for (const name of ['Got it', 'Skip all', 'Close']) {
      const notPrevented = fireEvent.keyDown(screen.getByRole('button', { name }), { key: 'Enter', repeat: true });
      expect({ name, notPrevented }).toEqual({ name, notPrevented: false });
    }
    // Första tryckningen (inte repeat) är opåverkad.
    expect(fireEvent.keyDown(screen.getByRole('button', { name: 'Got it' }), { key: 'Enter' })).toBe(true);
  });

  it('ingen permanent ring: inga klasser på knapparna sätter ring, outline eller skugga (CSS-sidan vaktas i badgeUpgradeCss.test.ts)', () => {
    renderDialog({ position: 1, total: 3 });
    for (const button of within(dialog()).getAllByRole('button')) {
      expect({ text: button.textContent, ring: /ring|outline|shadow/.test(button.className) }).toEqual({ text: button.textContent, ring: false });
    }
  });
});
