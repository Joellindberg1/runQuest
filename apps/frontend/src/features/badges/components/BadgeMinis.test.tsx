import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BadgeMinis } from './BadgeMinis';

// Minis-gruppen (RUN-131, spec §4 F5, Council 13): ETT element för skärmläsare, dekorativa minis inuti, ingen platshållare utan showcase.

describe('BadgeMinis', () => {
  it('gruppen är ETT img-element med en samlad etikett: tiernamn + serienamn, i ordning', () => {
    render(<BadgeMinis showcase={[{ series: 'milestoner', tier: 3 }, { series: 'climber', tier: 5 }]} />);

    const group = screen.getByRole('img', { name: 'Badges: Rare Milestoner, Epic Climber' });
    expect(group).toHaveAttribute('aria-label', 'Badges: Rare Milestoner, Epic Climber');
    // Minisen är dekorativa: inga egna img-element, så skärmläsaren läser gruppen en gång.
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it('varje mini är sm-emblem med aria-hidden och utan egen etikett', () => {
    const { container } = render(<BadgeMinis showcase={[{ series: 'milestoner', tier: 3 }, { series: 'climber', tier: 5 }, { series: 'night_owl', tier: 1 }]} />);

    const minis = container.querySelectorAll('.rq-badge');
    expect(minis).toHaveLength(3);
    for (const mini of minis) {
      expect(mini).toHaveClass('rq-badge--sm');
      expect(mini).toHaveAttribute('aria-hidden', 'true');
      expect(mini).not.toHaveAttribute('aria-label');
    }
    expect([...minis].map((mini) => mini.getAttribute('data-tier'))).toEqual(['rare', 'epic', 'common']);
  });

  it('ingen showcase: inga minis-element alls (ingen platshållare)', () => {
    const { container } = render(<BadgeMinis showcase={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('en enda mini ger en etikett utan avslutande komma', () => {
    render(<BadgeMinis showcase={[{ series: 'speedster', tier: 6 }]} />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Badges: Legendary Speedster');
  });
});
