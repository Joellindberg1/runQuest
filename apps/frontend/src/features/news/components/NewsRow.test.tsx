import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BADGE_SERIES, TIER_NAMES } from '@runquest/shared';
import { buildNewsRow, type NewsContext } from '../newsModel';
import { KARL, ME, NOW, badgeEarned, levelUp, releasePublished } from '../news.fixture';
import { NewsRow } from './NewsRow';

// badge_earned-raden i flödet (RUN-128, spec F7, Council 23): sm-emblem i ikonkolumnen (aria-hidden) i stället för zap, Levels-grön kant, typraden bär betydelsen.

const ctx: NewsContext = { viewerId: ME.id, now: NOW };
const streakKeeper = BADGE_SERIES.find((series) => series.key === 'streak_keeper') as (typeof BADGE_SERIES)[number];
const milestoner = BADGE_SERIES[0];

const renderRow = (row: ReturnType<typeof buildNewsRow>) => render(<ul>{row && <NewsRow row={row} />}</ul>);

describe('NewsRow — badge_earned (F7)', () => {
  it('ritar ett sm-emblem i ikonkolumnen i stället för kategorins ikon, aria-hidden', () => {
    const { container } = renderRow(buildNewsRow(badgeEarned(1, { actor: KARL }, { series: streakKeeper.key, tier: 1, previous_tier: null }), ctx));
    const iconCell = container.querySelector('.rq-news-row__icon') as HTMLElement;
    const emblem = iconCell.querySelector('.rq-badge');
    expect(emblem).toHaveClass('rq-badge--sm');
    expect(emblem).toHaveAttribute('data-tier', TIER_NAMES[0].toLowerCase());
    expect(emblem).toHaveAttribute('aria-hidden', 'true');
    // Ingen zap-ikon bredvid emblemet, och emblemet bär ingen egen etikett (texten under säger det).
    expect(iconCell.querySelectorAll(':scope > svg')).toHaveLength(0);
    expect(emblem).not.toHaveAttribute('aria-label');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('emblemet visar den NYA nivån vid "evolved"', () => {
    const { container } = renderRow(buildNewsRow(badgeEarned(1, { actor: ME }, { series: milestoner.key, tier: 3, previous_tier: 2 }), ctx));
    expect(container.querySelector('.rq-news-row__icon .rq-badge')).toHaveAttribute('data-tier', TIER_NAMES[2].toLowerCase());
  });

  it('typraden är "Badge earned" respektive "Badge evolved" och texten oförändrad', () => {
    const earned = renderRow(buildNewsRow(badgeEarned(1, { actor: KARL }, { series: streakKeeper.key, tier: 1, previous_tier: null }), ctx));
    expect(screen.getByText('Badge earned')).toHaveClass('rq-news-row__kind');
    expect(screen.getByText(`Karl earned ${streakKeeper.name} — ${TIER_NAMES[0]}.`)).toBeInTheDocument();
    earned.unmount();
    renderRow(buildNewsRow(badgeEarned(2, { actor: ME }, { series: milestoner.key, tier: 3, previous_tier: 2 }), ctx));
    expect(screen.getByText('Badge evolved')).toBeInTheDocument();
    expect(screen.getByText(`You evolved ${milestoner.name} from ${TIER_NAMES[1]} to ${TIER_NAMES[2]}.`)).toBeInTheDocument();
  });

  it('kanten förblir Levels (data-category="level") och raden har emblem-kolumnen', () => {
    const { container } = renderRow(buildNewsRow(badgeEarned(1), ctx));
    const row = container.querySelector('.rq-news-row') as HTMLElement;
    expect(row).toHaveAttribute('data-category', 'level');
    expect(row).toHaveAttribute('data-emblem');
  });

  it('okänd serie (annan serverversion) behåller reservikonen: inget emblem och ingen emblem-kolumn', () => {
    const { container } = renderRow(buildNewsRow(badgeEarned(1, {}, { series: 'retired_series', tier: 2, previous_tier: null }), ctx));
    expect(container.querySelector('.rq-badge')).toBeNull();
    expect(container.querySelector('.rq-news-row__icon svg')).not.toBeNull();
    expect(container.querySelector('.rq-news-row')).not.toHaveAttribute('data-emblem');
  });

  it('en tier utanför 1..6 ritar inget emblem som ljuger — reservikonen i stället', () => {
    const { container } = renderRow(buildNewsRow(badgeEarned(1, {}, { series: milestoner.key, tier: 9, previous_tier: null }), ctx));
    expect(container.querySelector('.rq-badge')).toBeNull();
    expect(container.querySelector('.rq-news-row__icon svg')).not.toBeNull();
  });

  it('övriga rader i Levels (level_up) är oförändrade: ikon, inget emblem', () => {
    const { container } = renderRow(buildNewsRow(levelUp(1, 25), ctx));
    expect(container.querySelector('.rq-badge')).toBeNull();
    expect(container.querySelector('.rq-news-row__icon svg')).not.toBeNull();
    expect(container.querySelector('.rq-news-row')).not.toHaveAttribute('data-emblem');
  });
});

describe('NewsRow — release_published (RUN-161)', () => {
  it('ritar sparkles-ikonen (ingen emblem-kolumn), typraden "New version" och texten "RunQuest vX is out — titel"', () => {
    const { container } = renderRow(buildNewsRow(releasePublished(1), ctx));
    const row = container.querySelector('.rq-news-row') as HTMLElement;
    expect(row).toHaveAttribute('data-category', 'release');
    expect(row).not.toHaveAttribute('data-emblem');
    expect(container.querySelector('.rq-news-row__icon svg')).not.toBeNull();
    expect(container.querySelector('.rq-badge')).toBeNull();
    expect(screen.getByText('New version')).toHaveClass('rq-news-row__kind');
    expect(screen.getByText('RunQuest v0.6.1 is out — News about releases')).toBeInTheDocument();
  });

  it('ingen länk eller knapp: nyhetsrader har inget klickmönster', () => {
    renderRow(buildNewsRow(releasePublished(1), ctx));
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
