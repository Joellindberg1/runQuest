import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BADGE_SERIES, MAX_TIER, TIER_NAMES } from '@runquest/shared';
import { RQIcon, type RQIconName } from '@/shared/components/icons';
import { BadgeEmblem } from './BadgeEmblem';
import { BadgePips } from './BadgePips';

// BadgeEmblem (RUN-127, spec §3): kronsköld i fem lager, nivån bärs av data-tier + etikett (aldrig bara färg). Allt om serierna
// (namn, ikon) läses ur @runquest/shared — testerna också.

const TIERS = Array.from({ length: MAX_TIER }, (_, index) => index + 1);
const FIRST_SERIES = BADGE_SERIES[0];

const iconMarkup = (root: Element): string => root.querySelector('svg')?.innerHTML ?? '';

describe('BadgeEmblem: nivå och lager', () => {
  it.each(TIERS)('tier %i får data-tier med nivåns namn i gemener', (tier) => {
    render(<BadgeEmblem series={FIRST_SERIES.key} tier={tier} size="md" />);
    expect(screen.getByRole('img')).toHaveAttribute('data-tier', TIER_NAMES[tier - 1].toLowerCase());
  });

  it('låst (tier null) får data-tier="locked"', () => {
    render(<BadgeEmblem series={FIRST_SERIES.key} tier={null} size="md" />);
    expect(screen.getByRole('img')).toHaveAttribute('data-tier', 'locked');
  });

  it('en tier utanför 1..6 eller en bråkdel behandlas som låst i stället för att rita en påhittad nivå', () => {
    for (const tier of [0, 7, -1, 2.5, Number.NaN]) {
      const { unmount } = render(<BadgeEmblem series={FIRST_SERIES.key} tier={tier} size="md" />);
      expect(screen.getByRole('img')).toHaveAttribute('data-tier', 'locked');
      unmount();
    }
  });

  it('lagren: glow-wrapper → ram → kärna → ikon; Heroic får dessutom hairline-ringen mellan ram och kärna', () => {
    const { container, rerender } = render(<BadgeEmblem series={FIRST_SERIES.key} tier={3} size="md" />);
    const root = screen.getByRole('img');
    expect(root).toHaveClass('rq-badge');
    const frame = root.querySelector('.rq-badge__frame');
    expect(frame).not.toBeNull();
    expect(frame?.querySelector('.rq-badge__ring')).toBeNull();
    expect(frame?.querySelector('.rq-badge__core svg')).not.toBeNull();

    rerender(<BadgeEmblem series={FIRST_SERIES.key} tier={4} size="md" />);
    const heroicFrame = container.querySelector('.rq-badge__frame');
    expect(heroicFrame?.querySelectorAll('.rq-badge__ring')).toHaveLength(1);
    // Ringen ligger FÖRE kärnan i DOM-ordningen (ritas under den).
    const children = Array.from(heroicFrame?.children ?? []).map((child) => child.className);
    expect(children.indexOf('rq-badge__ring')).toBeLessThan(children.indexOf('rq-badge__core'));
  });

  it('Heroic är den enda nivån med ring (icke-färgmarkören, Council 5)', () => {
    for (const tier of TIERS) {
      const { container, unmount } = render(<BadgeEmblem series={FIRST_SERIES.key} tier={tier} size="sm" />);
      expect(container.querySelectorAll('.rq-badge__ring')).toHaveLength(TIER_NAMES[tier - 1] === 'Heroic' ? 1 : 0);
      unmount();
    }
  });

  it('låst: ingen ring och ingen nivå, men samma sköld och ikon', () => {
    const { container } = render(<BadgeEmblem series={FIRST_SERIES.key} tier={null} size="md" />);
    expect(container.querySelectorAll('.rq-badge__ring')).toHaveLength(0);
    expect(container.querySelector('.rq-badge__core svg')).not.toBeNull();
  });
});

describe('BadgeEmblem: serieikonen kommer ur BADGE_SERIES', () => {
  it.each(BADGE_SERIES.map((series) => [series.key, series.icon] as const))('serien %s ritar RQIcon "%s"', (key, icon) => {
    const { container } = render(<BadgeEmblem series={key} tier={2} size="md" />);
    const expected = render(<RQIcon name={icon as RQIconName} />).container;
    expect(iconMarkup(container)).not.toBe('');
    expect(iconMarkup(container)).toBe(iconMarkup(expected));
  });

  it('samma ikon på alla sex nivåer och när serien är låst', () => {
    const reference = iconMarkup(render(<BadgeEmblem series={FIRST_SERIES.key} tier={1} size="md" />).container);
    for (const tier of [...TIERS, null]) {
      const { container, unmount } = render(<BadgeEmblem series={FIRST_SERIES.key} tier={tier} size="md" />);
      expect(iconMarkup(container)).toBe(reference);
      unmount();
    }
  });

  it('serierna har olika ikoner (annars skulle ett fel i mappningen inte synas)', () => {
    const markups = BADGE_SERIES.map((series) => iconMarkup(render(<BadgeEmblem series={series.key} tier={1} size="md" />).container));
    expect(new Set(markups).size).toBe(BADGE_SERIES.length);
  });

  it('ikonen är dekorativ (svg aria-hidden): emblemets etikett bär betydelsen, inte ikonen', () => {
    const { container } = render(<BadgeEmblem series={FIRST_SERIES.key} tier={2} size="md" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('en okänd serie (svar från en annan serverversion) kraschar inte och ritar reservikonen', () => {
    const { container } = render(<BadgeEmblem series="not_a_series" tier={2} size="md" />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('img')).toHaveAttribute('data-tier', 'uncommon');
  });
});

describe('BadgeEmblem: storlekar', () => {
  it.each(['sm', 'md', 'lg'] as const)('storleken %s sätts med klass (måtten ligger i --rq-badge-*-tokens)', (size) => {
    render(<BadgeEmblem series={FIRST_SERIES.key} tier={2} size={size} />);
    const root = screen.getByRole('img');
    expect(root).toHaveClass(`rq-badge--${size}`);
    expect(root.className.match(/rq-badge--(sm|md|lg)/g)).toHaveLength(1);
  });

  it('ingen inline-style: varken mått, färg eller glöd skrivs på elementen', () => {
    const { container } = render(<BadgeEmblem series={FIRST_SERIES.key} tier={6} size="lg" ignite />);
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });
});

describe('BadgeEmblem: tillgänglighet (spec §3, Council 5/13/23)', () => {
  it('role="img" med "{Tier} {Serie}" som aria-label och title (så att nivån aldrig bärs av färg ensam)', () => {
    const series = BADGE_SERIES[0];
    render(<BadgeEmblem series={series.key} tier={3} size="sm" />);
    const emblem = screen.getByRole('img', { name: `${TIER_NAMES[2]} ${series.name}` });
    expect(emblem).toHaveAttribute('aria-label', `${TIER_NAMES[2]} ${series.name}`);
    expect(emblem).toHaveAttribute('title', `${TIER_NAMES[2]} ${series.name}`);
  });

  it.each(TIERS)('etiketten för tier %i använder nivåns namn och seriens visningsnamn', (tier) => {
    const series = BADGE_SERIES[1];
    render(<BadgeEmblem series={series.key} tier={tier} size="md" />);
    expect(screen.getByRole('img')).toHaveAccessibleName(`${TIER_NAMES[tier - 1]} ${series.name}`);
  });

  it('låst: "Locked {Serie}"', () => {
    const series = BADGE_SERIES[2];
    render(<BadgeEmblem series={series.key} tier={null} size="md" />);
    expect(screen.getByRole('img')).toHaveAccessibleName(`Locked ${series.name}`);
  });

  it('decorative: aria-hidden, ingen role="img", ingen etikett och ingen title (grupp-/radtexten bär betydelsen)', () => {
    const { container } = render(<BadgeEmblem series={FIRST_SERIES.key} tier={3} size="sm" decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root).not.toHaveAttribute('role');
    expect(root).not.toHaveAttribute('aria-label');
    expect(root).not.toHaveAttribute('title');
    // Nivåmarkeringen för stilen finns kvar.
    expect(root).toHaveAttribute('data-tier', 'rare');
  });

  it('ikonen i ett meningsbärande emblem är inte en egen bildroll (en enda img per emblem)', () => {
    render(<BadgeEmblem series={FIRST_SERIES.key} tier={5} size="lg" />);
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });
});

describe('BadgeEmblem: tändning (ignite)', () => {
  it('utan ignite saknas tändningsklassen (samlingen, Board och Runner card tänder inget)', () => {
    render(<BadgeEmblem series={FIRST_SERIES.key} tier={6} size="lg" />);
    expect(screen.getByRole('img')).not.toHaveClass('rq-badge--ignite');
  });

  it.each(TIERS)('ignite sätter tändningsklassen på tier %i', (tier) => {
    render(<BadgeEmblem series={FIRST_SERIES.key} tier={tier} size="lg" ignite />);
    expect(screen.getByRole('img')).toHaveClass('rq-badge--ignite');
  });

  it('en låst serie tänds aldrig (det finns inget att tända)', () => {
    render(<BadgeEmblem series={FIRST_SERIES.key} tier={null} size="lg" ignite />);
    expect(screen.getByRole('img')).not.toHaveClass('rq-badge--ignite');
  });
});

describe('BadgePips (T7): position, aldrig framsteg', () => {
  it.each(TIERS)('tier %i: sex pips, de första %i fyllda, textmotsvarigheten "Tier N of 6"', (tier) => {
    const { container } = render(<BadgePips tier={tier} />);
    const pips = screen.getByRole('img', { name: `Tier ${tier} of ${MAX_TIER}` });
    expect(pips).toHaveAttribute('data-tier', TIER_NAMES[tier - 1].toLowerCase());
    const cells = container.querySelectorAll('.rq-badge-pips__pip');
    expect(cells).toHaveLength(MAX_TIER);
    expect(Array.from(cells).map((cell) => cell.classList.contains('rq-badge-pips__pip--on'))).toEqual(
      Array.from({ length: MAX_TIER }, (_, index) => index < tier),
    );
  });

  it('låst: inga fyllda pips och texten "Locked"', () => {
    const { container } = render(<BadgePips tier={null} />);
    expect(screen.getByRole('img', { name: 'Locked' })).toHaveAttribute('data-tier', 'locked');
    expect(container.querySelectorAll('.rq-badge-pips__pip--on')).toHaveLength(0);
    expect(container.querySelectorAll('.rq-badge-pips__pip')).toHaveLength(MAX_TIER);
  });

  it('en ogiltig tier behandlas som låst', () => {
    render(<BadgePips tier={9} />);
    expect(screen.getByRole('img', { name: 'Locked' })).toBeInTheDocument();
  });

  it('decorative: aria-hidden utan etikett (när radens egen text redan säger nivån)', () => {
    const { container } = render(<BadgePips tier={2} decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('cellerna är dolda för skärmläsare (etiketten på gruppen räcker)', () => {
    const { container } = render(<BadgePips tier={2} />);
    for (const cell of container.querySelectorAll('.rq-badge-pips__pip')) expect(cell).toHaveAttribute('aria-hidden', 'true');
  });
});
