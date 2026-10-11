import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { BADGE_SERIES, MAX_SHOWCASE, MAX_TIER, TIER_NAMES } from '@runquest/shared';
import type { BadgeUserItem } from '@runquest/shared';
import { buildCollection } from '../badgeModel';
import type { ShowcaseDraft } from '../hooks/useShowcaseDraft';
import { BadgeDisplayStrip } from './BadgeDisplayStrip';

// ON DISPLAY-remsan (spec F9.3): minis med utkastet, SAVE DISPLAY i tre lägen (osparat / sparar / rent), hjälptexter per bredd och de tre statusraderna.
// Komponenten är ren presentation över `useShowcaseDraft`-resultatet, så utkastet ges här som ett färdigt objekt. Texterna räknas ur shared.

const [milestoner, earthTrotter, , streakKeeper] = BADGE_SERIES;
const LIMIT_ID = 'limit-sentence';
const LIMIT_TEXT = `${MAX_SHOWCASE} of ${MAX_SHOWCASE} on display — remove one first.`;

const item = (series: string, tier: number): BadgeUserItem => ({ series, tier, earned_at: '2026-10-01T12:00:00Z', seen_tier: tier });
const rows = buildCollection(
  { items: [item(milestoner.key, 3), item(earthTrotter.key, 2), item(streakKeeper.key, MAX_TIER)], showcase: [] },
  undefined,
  { viewerId: 'u-me', ownerId: 'u-me' },
);

function draftOf(overrides: Partial<ShowcaseDraft> = {}): ShowcaseDraft {
  return {
    draft: [], saved: [], dirty: false, full: false, status: 'idle', saving: false, announcement: '',
    positionOf: () => null, toggle: vi.fn(), save: vi.fn(async () => {}), ...overrides,
  };
}

function renderStrip(overrides: Partial<ShowcaseDraft> = {}, isDesktop: boolean | undefined = false) {
  const display = draftOf(overrides);
  const view = render(<BadgeDisplayStrip rows={rows} display={display} limitId={LIMIT_ID} isDesktop={isDesktop} />);
  const again = (next: Partial<ShowcaseDraft>) => view.rerender(<BadgeDisplayStrip rows={rows} display={{ ...display, ...next }} limitId={LIMIT_ID} isDesktop={isDesktop} />);
  return { display, again, ...view };
}
const saveButton = () => screen.getByRole('button', { name: /^(SAVE DISPLAY|SAVING…|SAVED)$/ });

describe('BadgeDisplayStrip — remsan', () => {
  it('är en grupp "On display" med etikett och minis i utkastets ordning (nivå + serie i etiketten)', () => {
    renderStrip({ draft: [streakKeeper.key, milestoner.key] });
    const group = screen.getByRole('group', { name: 'On display' });
    expect(within(group).getByText('On display')).toBeInTheDocument();
    expect(within(group).getByRole('img', { name: `Badges: ${TIER_NAMES[MAX_TIER - 1]} ${streakKeeper.name}, ${TIER_NAMES[2]} ${milestoner.name}` })).toBeInTheDocument();
  });

  it('tomt utkast: inga minis och ingen platshållare; mobil visar uppmaningen', () => {
    renderStrip({ draft: [] }, false);
    const group = screen.getByRole('group', { name: 'On display' });
    expect(within(group).queryByRole('img')).toBeNull();
    expect(group.querySelector('.rq-badge')).toBeNull();
    expect(within(group).getByText(`Pick up to ${MAX_SHOWCASE} badges to show on the Board.`)).toBeInTheDocument();
  });

  it('desktop: hjälptexten visas hela tiden (även med valda) och uppmaningen för tomt utkast ersätter den inte', () => {
    const { unmount } = renderStrip({ draft: [] }, true);
    const hint = `Shown on your Board card and next to your name — pick up to ${MAX_SHOWCASE} below.`;
    expect(screen.getByText(hint)).toBeInTheDocument();
    expect(screen.queryByText(/^Pick up to/)).toBeNull();
    unmount();
    renderStrip({ draft: [milestoner.key] }, true);
    expect(screen.getByText(hint)).toBeInTheDocument();
  });

  it('mobil med valda: ingen hjälptext och ingen uppmaning', () => {
    renderStrip({ draft: [milestoner.key] }, false);
    expect(screen.queryByText(/Shown on your Board card/)).toBeNull();
    expect(screen.queryByText(/^Pick up to/)).toBeNull();
  });

  it('innan brytpunkten är läst (isDesktop undefined) ritas ingen bredd-beroende text', () => {
    // Direkt render: ett `undefined` till renderStrip hade fallit tillbaka på dess standardvärde (mobil).
    render(<BadgeDisplayStrip rows={rows} display={draftOf({ draft: [] })} limitId={LIMIT_ID} isDesktop={undefined} />);
    expect(screen.queryByText(/Shown on your Board card/)).toBeNull();
    expect(screen.queryByText(/^Pick up to/)).toBeNull();
    expect(saveButton()).toBeInTheDocument();
  });
});

describe('BadgeDisplayStrip — SAVE DISPLAY (F9.3)', () => {
  it('osparat: "SAVE DISPLAY", inte aria-disabled, ett klick sparar', () => {
    const { display } = renderStrip({ draft: [milestoner.key], dirty: true });
    expect(saveButton()).toHaveTextContent('SAVE DISPLAY');
    expect(saveButton()).not.toHaveAttribute('aria-disabled');
    fireEvent.click(saveButton());
    expect(display.save).toHaveBeenCalledTimes(1);
  });

  it('rent (utkast = sparat): "SAVED" och aria-disabled — inte disabled, så fokus kan ligga kvar — och klicket sparar inget', () => {
    const { display } = renderStrip({ draft: [milestoner.key], saved: [milestoner.key], dirty: false });
    expect(saveButton()).toHaveTextContent('SAVED');
    expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
    expect(saveButton()).not.toBeDisabled();
    fireEvent.click(saveButton());
    expect(display.save).not.toHaveBeenCalled();
  });

  it('sparar: "SAVING…" och aria-disabled; klicket ignoreras', () => {
    const { display } = renderStrip({ draft: [milestoner.key], dirty: true, saving: true, status: 'saving' });
    expect(saveButton()).toHaveTextContent('SAVING…');
    expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(saveButton());
    expect(display.save).not.toHaveBeenCalled();
  });

  it('är den enda guldknappen: en .rq-btn--secondary i remsan, ingen fylld primärknapp', () => {
    const { container } = renderStrip({ draft: [milestoner.key], dirty: true, status: 'error' });
    expect(container.querySelectorAll('.rq-btn--secondary')).toHaveLength(1);
    expect(container.querySelectorAll('.rq-btn--primary')).toHaveLength(0);
    expect(saveButton()).toHaveClass('rq-btn--secondary');
  });

  it('fokus stannar på SAVE DISPLAY när etiketten byter läge (samma element, aldrig disabled)', () => {
    const { again } = renderStrip({ draft: [milestoner.key], dirty: true });
    saveButton().focus();
    const before = saveButton();
    again({ saving: true, status: 'saving' });
    expect(saveButton()).toBe(before);
    expect(saveButton()).toHaveFocus();
    again({ dirty: false, saving: false, status: 'saved' });
    expect(saveButton()).toBe(before);
    expect(saveButton()).toHaveFocus();
  });
});

describe('BadgeDisplayStrip — statusrader (F9.3)', () => {
  it('3 av 3: den synliga meningen har id = limitId och ligger i en aria-live="polite"-region', () => {
    renderStrip({ draft: [streakKeeper.key, milestoner.key, earthTrotter.key], full: true });
    const sentence = screen.getByText(LIMIT_TEXT);
    expect(sentence).toBeVisible();
    expect(sentence).toHaveAttribute('id', LIMIT_ID);
    expect(sentence.closest('[aria-live="polite"]')).not.toBeNull();
  });

  it('inte fullt: ingen mening — men live-regionen finns redan, så nästa text annonseras', () => {
    const { container, again } = renderStrip({ draft: [milestoner.key] });
    expect(screen.queryByText(LIMIT_TEXT)).toBeNull();
    const live = container.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live).not.toBeNull();
    again({ draft: [milestoner.key, earthTrotter.key, streakKeeper.key], full: true });
    expect(container.querySelector('[aria-live="polite"]')).toBe(live);
    expect(within(live).getByText(LIMIT_TEXT)).toBeInTheDocument();
  });

  it('senaste ändringen läses upp i en sr-only-rad i samma live-region', () => {
    const { container } = renderStrip({ announcement: `${milestoner.name} added to display, position 1.` });
    const live = container.querySelector('[aria-live="polite"]') as HTMLElement;
    const line = within(live).getByText(`${milestoner.name} added to display, position 1.`);
    expect(line).toHaveClass('sr-only');
  });

  it('sparat: role="status" med "Saved — your Board card is updated." och grön tillståndskant (data-status="saved")', () => {
    renderStrip({ status: 'saved' });
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Saved — your Board card is updated.');
    expect(within(status).getByText('Saved — your Board card is updated.')).toHaveAttribute('data-status', 'saved');
    expect(within(screen.getByRole('alert')).queryByText(/Could not save/)).toBeNull();
  });

  it('behållarna för sparat och fel finns före texten (permanenta live-regioner)', () => {
    const { again } = renderStrip({ status: 'idle' });
    const status = screen.getByRole('status');
    const alert = screen.getByRole('alert');
    expect(status).toBeEmptyDOMElement();
    expect(alert).toBeEmptyDOMElement();
    again({ status: 'error', dirty: true });
    expect(screen.getByRole('alert')).toBe(alert);
    expect(alert).toHaveTextContent('Could not save. Your pick is still here — try again.');
    again({ status: 'saved' });
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent('Saved — your Board card is updated.');
  });

  it('fel: role="alert" med röd kant (data-status="error") och RETRY', () => {
    renderStrip({ status: 'error', dirty: true, draft: [milestoner.key] });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not save. Your pick is still here — try again.');
    expect(alert.querySelector('[data-status="error"]')).not.toBeNull();
    expect(within(alert).getByRole('button', { name: 'RETRY' })).toBeInTheDocument();
    // Felet är osparat: knappen säger SAVE DISPLAY och går att trycka.
    expect(saveButton()).toHaveTextContent('SAVE DISPLAY');
    expect(saveButton()).not.toHaveAttribute('aria-disabled');
  });

  it('RETRY flyttar fokus till SAVE DISPLAY och sparar om', () => {
    const { display } = renderStrip({ status: 'error', dirty: true, draft: [milestoner.key] });
    const retry = screen.getByRole('button', { name: 'RETRY' });
    retry.focus();
    fireEvent.click(retry);
    expect(saveButton()).toHaveFocus();
    expect(display.save).toHaveBeenCalledTimes(1);
  });

  it('RETRY flyttar fokus FÖRE sparandet startar (felraden försvinner först när save() har anropats)', () => {
    const order: string[] = [];
    const { display } = renderStrip({ status: 'error', dirty: true, draft: [milestoner.key] });
    vi.mocked(display.save).mockImplementation(async () => {
      order.push(`save:${document.activeElement?.textContent}`);
    });
    fireEvent.click(screen.getByRole('button', { name: 'RETRY' }));
    expect(order).toEqual(['save:SAVE DISPLAY']);
  });
});
