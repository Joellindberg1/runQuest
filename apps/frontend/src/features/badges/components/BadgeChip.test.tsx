import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TIER_NAMES } from '@runquest/shared';
import { BadgeChip } from './BadgeChip';

// Nivå-chippet (spec §3, Council 5, 9, 14): intjänat = status-receptet med nivåns färg; låst = bara basprimitiven `.rq-chip` (text --rq-text-4, .50, ≥ 4.5:1).

describe('BadgeChip', () => {
  it('låst chip använder bara .rq-chip: inget --status, ingen nivåfärg, ingen data-tier', () => {
    const { container } = render(<BadgeChip tier={null} />);
    const chip = screen.getByText('Locked');
    expect(chip.className).toBe('rq-chip');
    expect(chip).not.toHaveAttribute('data-tier');
    expect(container.querySelectorAll('.rq-chip--status, .rq-badge-chip')).toHaveLength(0);
  });

  it('allt ogiltigt (0, 7, bråkdel) är också ett rent låst chip', () => {
    for (const tier of [0, 7, 2.5, Number.NaN]) {
      const { unmount } = render(<BadgeChip tier={tier} />);
      expect(screen.getByText('Locked').className).toBe('rq-chip');
      unmount();
    }
  });

  it('intjänat chip: nivåns namn som text, status-receptet och data-tier — nivån bärs av texten, inte färgen', () => {
    TIER_NAMES.forEach((name, index) => {
      const { unmount } = render(<BadgeChip tier={index + 1} />);
      const chip = screen.getByText(name);
      expect(chip).toHaveClass('rq-chip', 'rq-chip--status', 'rq-badge-chip');
      expect(chip).toHaveAttribute('data-tier', name.toLowerCase());
      unmount();
    });
  });
});
