import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { BADGE_SERIES, TIER_NAMES, type NewsItem } from '@runquest/shared';
import { KARL, ME, NOW_ISO, at, badgeEarned, levelUp, newsServer, releasePublished } from '../news.fixture';
import { handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import { NewsPopoverPanel } from './NewsPopoverPanel';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);

// Klock-popoverns badge_earned-rader (RUN-128, spec F7 högra panelen): sm-emblem (aria-hidden, Council 23) i stället för pricken. Övriga rader är oförändrade.

const milestoner = BADGE_SERIES[0];

function setup(feed: NewsItem[]) {
  const server = newsServer(feed, null);
  handlers.getNews = (...args: unknown[]) => server.getNews(...(args as [never]));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW_ISO));
  resetFakeBackend();
});
afterEach(() => vi.useRealTimers());

const rows = () => within(screen.getByRole('list', { name: 'Latest news' })).getAllByRole('listitem');

describe('NewsPopoverPanel — badge_earned (F7)', () => {
  it('ritar ett sm-emblem i stället för pricken, aria-hidden, med den nya nivån', async () => {
    setup([badgeEarned(2, { actor: ME, occurred_at: at(3) }, { series: milestoner.key, tier: 3, previous_tier: 2 }), badgeEarned(1, { actor: KARL, occurred_at: at(5) })]);
    renderWithApp(<NewsPopoverPanel onClose={() => {}} />);
    await screen.findByRole('list', { name: 'Latest news' });
    const [evolved, earned] = rows();

    const emblem = evolved.querySelector('.rq-news-pop__emblem .rq-badge');
    expect(emblem).toHaveClass('rq-badge--sm');
    expect(emblem).toHaveAttribute('data-tier', TIER_NAMES[2].toLowerCase());
    expect(emblem).toHaveAttribute('aria-hidden', 'true');
    expect(evolved.querySelector('.rq-news-pop__dot')).toBeNull();
    expect(evolved).toHaveAttribute('data-emblem');
    expect(within(evolved).getByText('Badge evolved')).toBeInTheDocument();
    expect(within(evolved).getByText(`You evolved ${milestoner.name} from ${TIER_NAMES[1]} to ${TIER_NAMES[2]}.`)).toBeInTheDocument();
    expect(earned.querySelector('.rq-news-pop__emblem .rq-badge')).toHaveAttribute('data-tier', TIER_NAMES[0].toLowerCase());
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('övriga rader och en okänd serie behåller pricken, utan emblem', async () => {
    setup([levelUp(2, 25, { occurred_at: at(2) }), badgeEarned(1, { occurred_at: at(3) }, { series: 'retired_series', tier: 2, previous_tier: null })]);
    renderWithApp(<NewsPopoverPanel onClose={() => {}} />);
    await screen.findByRole('list', { name: 'Latest news' });
    for (const row of rows()) {
      expect(row.querySelector('.rq-news-pop__dot')).not.toBeNull();
      expect(row.querySelector('.rq-badge')).toBeNull();
      expect(row).not.toHaveAttribute('data-emblem');
    }
  });
});

describe('NewsPopoverPanel — release_published', () => {
  it('visar raden med "New version" och releasetexten, kategorin release och pricken (inget emblem)', async () => {
    setup([releasePublished(2, { occurred_at: at(1) }, { version: '0.6.1', title: 'News about releases' }), levelUp(1, 25, { occurred_at: at(3) })]);
    renderWithApp(<NewsPopoverPanel onClose={() => {}} />);
    await screen.findByRole('list', { name: 'Latest news' });
    const [release, level] = rows();
    expect(release).toHaveAttribute('data-category', 'release');
    expect(release).not.toHaveAttribute('data-emblem');
    expect(release.querySelector('.rq-news-pop__dot')).not.toBeNull();
    expect(within(release).getByText('New version')).toBeInTheDocument();
    expect(within(release).getByText('RunQuest v0.6.1 is out — News about releases')).toBeInTheDocument();
    expect(level).toHaveAttribute('data-category', 'level');
  });
});
