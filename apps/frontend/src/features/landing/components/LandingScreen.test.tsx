import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LandingScreen } from './LandingScreen';

// Landing är publik och gör inga anrop (ägarbeslut 4): ingen QueryClientProvider, ingen AuthContext — bara routern för länkarna.
const renderLanding = () =>
  render(
    <MemoryRouter>
      <LandingScreen />
    </MemoryRouter>,
  );

const stubMatchMedia = (reduced: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && /prefers-reduced-motion/.test(query),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Landing — struktur och tillgänglighet', () => {
  it('har landmärkena banner, main och contentinfo — en av varje', () => {
    renderLanding();
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
    expect(within(screen.getByRole('contentinfo')).getByText('Run · Rank · Reign')).toBeInTheDocument();
  });

  it('rubrikhierarkin: en h1, sedan h2 per sektion och h3 per steg — inga hopp', () => {
    renderLanding();
    const headings = screen.getAllByRole('heading').map((heading) => [Number(heading.tagName[1]), heading.textContent]);
    expect(headings).toEqual([
      [1, 'Your group chat deserves a leaderboard'],
      [2, 'RunQuest so far'],
      [2, 'Sample pack'],
      [2, 'How it works'],
      [3, 'Log the run'],
      [3, 'Earn XP'],
      [3, 'Keep the streak'],
      [3, 'Take the title'],
    ]);
  });

  it('varje sektion är ett namngivet landmärke via sin rubrik', () => {
    renderLanding();
    for (const name of ['Your group chat deserves a leaderboard', 'RunQuest so far', 'Sample pack', 'How it works']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
  });

  it('arena-banan är ren dekor: gömd för skärmläsare', () => {
    const { container } = renderLanding();
    const arena = container.querySelector('.rq-landing-arena');
    expect(arena).toHaveAttribute('aria-hidden', 'true');
    expect(within(arena as HTMLElement).queryByRole('img')).toBeNull();
  });

  it('wordmarken har ett namn', () => {
    renderLanding();
    expect(within(screen.getByRole('banner')).getByRole('img', { name: 'RunQuest' })).toBeInTheDocument();
  });
});

describe('Landing — knappar (en guldknapp per vy)', () => {
  it('exakt EN primärknapp: "Sign in to your pack" → /login', () => {
    const { container } = renderLanding();
    expect(container.querySelectorAll('.rq-btn--primary')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Sign in to your pack' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Sign in to your pack' })).toHaveClass('rq-btn--primary');
  });

  it('sekundärknappen hoppar till How it works, och målet finns', () => {
    const { container } = renderLanding();
    const link = screen.getByRole('link', { name: 'See how it works' });
    expect(link).toHaveAttribute('href', '#how-it-works');
    expect(link).not.toHaveClass('rq-btn--primary');
    expect(container.querySelector('#how-it-works')).toBe(screen.getByRole('region', { name: 'How it works' }));
  });

  it('"Create your pack" finns inte som knapp — den väntar på multi-grupp (ägarbeslut 4); sidan säger det i stället', () => {
    renderLanding();
    expect(screen.queryByRole('link', { name: /create your pack/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /create your pack/i })).toBeNull();
    expect(screen.getByText('Starting your own pack is coming soon.')).toBeInTheDocument();
  });
});

describe('Landing — innehåll', () => {
  it('märket, ingressen och aggregaten', () => {
    stubMatchMedia(true);
    renderLanding();
    expect(screen.getByText(/14 packs running/)).toBeInTheDocument();
    expect(screen.getByText(/Every run earns XP\. XP becomes levels, levels become titles/)).toBeInTheDocument();

    const stats = within(screen.getByRole('region', { name: 'RunQuest so far' }));
    expect(stats.getByText('km').nextElementSibling).toHaveTextContent('128 430');
    expect(stats.getByText('runs').nextElementSibling).toHaveTextContent('9 412');
    expect(stats.getByText('XP').nextElementSibling).toHaveTextContent('1 284 600');
  });

  it('aggregaten: skärmläsare får slutvärdet, det animerade talet är gömt', () => {
    stubMatchMedia(false);
    renderLanding();
    const km = screen.getByText('km').nextElementSibling as HTMLElement;
    const [animated, final] = Array.from(km.children);
    expect(animated).toHaveAttribute('aria-hidden', 'true');
    expect(animated).toHaveTextContent('0');
    expect(final).toHaveClass('sr-only');
    expect(final).toHaveTextContent('128 430');
  });

  it('previewkortet: fem förnamn med plats, XP och rank-pilar som skärmläsare kan läsa', () => {
    renderLanding();
    const card = within(screen.getByRole('region', { name: 'Sample pack' }));
    const rows = card.getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('.rq-name')?.textContent)).toEqual(['Anna', 'Erik', 'Maria', 'Johan', 'Sara']);
    expect(within(rows[0]).getByText('8 420', { exact: false })).toBeInTheDocument();
    expect(within(rows[0]).getByRole('img', { name: 'Up 1 place' })).toBeInTheDocument();
    expect(within(rows[1]).getByRole('img', { name: 'Down 1 place' })).toBeInTheDocument();
    expect(within(rows[2]).getByRole('img', { name: 'No change' })).toBeInTheDocument();
    expect(within(rows[3]).getByRole('img', { name: 'Up 2 places' })).toBeInTheDocument();
  });

  it('previewn visar inga efternamn — den är anonymiserad', () => {
    const { container } = renderLanding();
    expect(container.textContent).not.toMatch(/Lindqvist|Svensson|Johansson|Karlsson|Nilsson/);
  });

  it('How it works: fyra steg ur modellen, i en lista', () => {
    renderLanding();
    const steps = within(screen.getByRole('region', { name: 'How it works' })).getAllByRole('listitem');
    expect(steps).toHaveLength(4);
    expect(within(steps[1]).getByText(/Base 15 plus 2 per km/)).toBeInTheDocument();
    expect(within(steps[2]).getByText(/from day 5/)).toBeInTheDocument();
  });
});

describe('Landing — inga anrop', () => {
  it('gör inget nätverksanrop vid rendering (ingen endpoint, ägarbeslut 4)', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderLanding();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
