import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { track } from '@/shared/analytics/track';
import { setViewportWidth } from '@/test/viewport';
import { LandingScreen } from './LandingScreen';

vi.mock('@/shared/analytics/track', () => ({ track: vi.fn() }));

const MOBILE = 390;
const DESKTOP = 1440;

const statsResponse = () => new Response(JSON.stringify({ success: true, data: { runners: 6, challenges: 4, km: 4551 } }), { status: 200 });

interface RenderOptions {
  width?: number;
  /** Svar på fetch; standard är prods tal (6 löpare · 4 utmaningar · 4 551 km). */
  respond?: () => Response | Promise<Response>;
}

/** Landing med riktig router och query-klient; fetch är spionen som vaktar att sidan bara hämtar de tre talen. */
function renderLanding({ width = MOBILE, respond = statsResponse }: RenderOptions = {}) {
  setViewportWidth(width);
  const fetchSpy = vi.fn(() => Promise.resolve(respond()));
  vi.stubGlobal('fetch', fetchSpy);
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LandingScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, fetchSpy };
}

const loaded = () => screen.findByText('km logged');

const headingOutline = () => screen.getAllByRole('heading').map((heading) => [Number(heading.tagName[1]), heading.textContent]);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(track).mockClear();
});

describe('Landing — struktur och tillgänglighet', () => {
  it('har landmärkena banner, main och contentinfo — en av varje', async () => {
    renderLanding();
    await loaded();
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
  });

  it('rubrikhierarkin på desktop: en h1, h2 per sektion, h3 per steg, kort och förklaring — inga hopp', async () => {
    renderLanding({ width: DESKTOP });
    await loaded();
    expect(headingOutline()).toEqual([
      [1, 'Your group chat deserves a leaderboard'],
      [2, 'RunQuest in numbers'],
      [2, 'From a run to a rank'],
      [2, 'The leaderboard, live'],
      [3, 'Sample pack'],
      [3, 'Rank changes show up'],
      [3, 'Levels, not just totals'],
      [3, 'Events give easy XP'],
      [2, 'Four things decide your rank'],
      [3, 'Log the run'],
      [3, 'Earn XP'],
      [3, 'Keep the streak'],
      [3, 'Take the title'],
      [2, "What's in the game"],
      [3, 'Leaderboard'],
      [3, 'Titles'],
      [3, 'Challenges'],
      [3, 'Events'],
      [3, 'Strava sync'],
      [3, 'The journey'],
      [2, 'Join the waitlist'],
    ]);
  });

  it('rubrikhierarkin på mobil är densamma men utan de tre förklaringarna bredvid kortet', async () => {
    renderLanding({ width: MOBILE });
    await loaded();
    const titles = headingOutline().map(([, text]) => text);
    expect(titles).not.toContain('Rank changes show up');
    expect(titles).not.toContain('Events give easy XP');
    expect(headingOutline().slice(0, 4)).toEqual([
      [1, 'Your group chat deserves a leaderboard'],
      [2, 'RunQuest in numbers'],
      [2, 'The leaderboard, live'],
      [3, 'Sample pack'],
    ]);
  });

  it('sektionerna är namngivna landmärken via sin rubrik', async () => {
    renderLanding({ width: DESKTOP });
    await loaded();
    for (const name of ['Your group chat deserves a leaderboard', 'RunQuest in numbers', 'The leaderboard, live', 'Four things decide your rank', "What's in the game"]) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
  });

  it('wordmarken har ett namn', async () => {
    renderLanding();
    await loaded();
    expect(within(screen.getByRole('banner')).getByRole('img', { name: 'RunQuest' })).toBeInTheDocument();
  });

  it('banan, rutnätet och glöden är gömda för skärmläsare', async () => {
    const { container } = renderLanding({ width: DESKTOP });
    await loaded();
    const decor = [...container.querySelectorAll('[data-decor]')];
    expect(decor.map((node) => node.getAttribute('data-decor')).sort()).toEqual(['arena', 'fade', 'glow', 'grid']);
    for (const node of decor) expect(node).toHaveAttribute('aria-hidden', 'true');
    expect(within(decor.find((node) => node.getAttribute('data-decor') === 'arena') as HTMLElement).queryByRole('img')).toBeNull();
  });
});

describe('Landing — webbanalys', () => {
  it.each([[MOBILE], [DESKTOP]])('reports waitlist-click when the Join the waitlist button in the hero is clicked, at %i px', async (width) => {
    renderLanding({ width });
    await loaded();
    expect(track).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole('region', { name: 'Your group chat deserves a leaderboard' })).getByRole('link', { name: 'Join the waitlist' }));
    expect(track).toHaveBeenCalledExactlyOnceWith('waitlist-click');
  });

  it.each([[MOBILE], [DESKTOP]])('reports login-click when Sign in in the header is clicked, at %i px', async (width) => {
    renderLanding({ width });
    await loaded();
    await userEvent.click(within(screen.getByRole('banner')).getByRole('link', { name: 'Sign in' }));
    expect(track).toHaveBeenCalledExactlyOnceWith('login-click');
  });

  it('reports nothing for the other links in the header', async () => {
    renderLanding({ width: DESKTOP });
    await loaded();
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Sections' })).getByRole('link', { name: 'Titles' }));
    expect(track).not.toHaveBeenCalled();
  });
});

describe('Landing — header och knappar', () => {
  it.each([[MOBILE], [DESKTOP]])('Sign in är en konturknapp i headern och leder till /login på %i px', async (width) => {
    renderLanding({ width });
    await loaded();
    const signIn = within(screen.getByRole('banner')).getByRole('link', { name: 'Sign in' });
    expect(signIn).toHaveAttribute('href', '/login');
    expect(signIn).toHaveClass('rq-btn', 'rq-btn--secondary');
    expect(signIn).not.toHaveClass('rq-btn--primary');
  });

  it('guldknappen i hjälten heter Join the waitlist och pekar på väntelistans formulär', async () => {
    renderLanding({ width: DESKTOP });
    await loaded();
    const join = screen.getByRole('link', { name: 'Join the waitlist' });
    expect(join).toHaveAttribute('href', '#waitlist');
    expect(join).toHaveClass('rq-btn--primary');
    expect(within(screen.getByRole('region', { name: 'Your group chat deserves a leaderboard' })).getByRole('link', { name: 'Join the waitlist' })).toBe(join);
  });

  it('inga andra guldknappar än Join the waitlist finns på sidan: hjältens länk och formulärets skicka-knapp', async () => {
    const { container } = renderLanding({ width: DESKTOP });
    await loaded();
    const gold = [...container.querySelectorAll('.rq-btn--primary')];
    expect(gold.map((node) => node.textContent)).toEqual(['Join the waitlist', 'Join the waitlist']);
    const [heroLink, submit] = gold;
    expect(heroLink).toHaveAttribute('href', '#waitlist');
    expect(submit).toHaveAttribute('type', 'submit');
    expect(container.querySelector('#waitlist')).toContainElement(submit as HTMLElement);
  });

  it('Watch the film är en neutral konturknapp bredvid guldknappen, med platshållaren som mål', async () => {
    renderLanding({ width: DESKTOP });
    await loaded();
    const watch = screen.getByRole('link', { name: 'Watch the film — 0:49' });
    expect(watch).toHaveAttribute('href', '#film');
    expect(watch).toHaveClass('rq-btn--ghost');
    expect(watch).not.toHaveClass('rq-btn--primary');
  });

  it('headern saknar Create a pack och hjälten saknar Create your pack', async () => {
    renderLanding({ width: DESKTOP });
    await loaded();
    expect(screen.queryByRole('link', { name: /create (a|your) pack/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /create (a|your) pack/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /see how it works|sign in to your pack/i })).toBeNull();
  });

  it('inloggningsrutan, pack-namnfältet och coming soon-texten finns inte', async () => {
    renderLanding({ width: DESKTOP });
    await loaded();
    expect(screen.queryByLabelText(/username|password/i)).toBeNull();
    // Enda textfältet på sidan är väntelistans e-post.
    const fields = screen.queryAllByRole('textbox');
    expect(fields).toHaveLength(1);
    expect(fields[0]).toHaveAttribute('type', 'email');
    expect(document.querySelector('#waitlist')).toContainElement(fields[0]);
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(screen.queryByText(/pack name|start a pack/i)).toBeNull();
  });

  it('navigeringen visas bara på desktop och pekar på filmen, How it works och funktionerna', async () => {
    const desktop = renderLanding({ width: DESKTOP });
    await loaded();
    const nav = within(screen.getByRole('navigation', { name: 'Sections' }));
    expect(nav.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['The game', '#film'], ['XP & levels', '#how-it-works'], ['Titles', '#features'],
    ]);
    expect(screen.queryByRole('link', { name: 'Playbook' })).toBeNull();
    desktop.unmount();

    renderLanding({ width: MOBILE });
    await loaded();
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull();
  });

  it('sidan har en h1 och tab-ordningen går från headern till hjältens knappar', async () => {
    const { container } = renderLanding({ width: DESKTOP });
    await loaded();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);

    const focusable = [...container.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')];
    expect(focusable.every((node) => !(Number(node.getAttribute('tabindex')) > 0))).toBe(true);
    const names = focusable.map((node) => node.textContent);
    const order = ['The game', 'XP & levels', 'Titles', 'Sign in', 'Join the waitlist', 'Watch the film — 0:49'];
    expect(names.slice(0, order.length)).toEqual(order);
  });
});

describe('Landing — platser för film och väntelista', () => {
  it('filmen och väntelistan är monterade i sina ankare, exakt en gång var', async () => {
    const { container } = renderLanding({ width: DESKTOP });
    await loaded();
    for (const id of ['film', 'waitlist']) {
      expect(container.querySelectorAll(`#${id}`)).toHaveLength(1);
      expect(container.querySelector(`#${id}`)?.tagName).toBe('SECTION');
    }
    expect(screen.getByRole('region', { name: 'From a run to a rank' })).toHaveAttribute('id', 'film');
    expect(screen.getByRole('region', { name: 'Join the waitlist' })).toHaveAttribute('id', 'waitlist');
  });

  it('filmen ligger mellan hjälten och previewn, väntelistan efter funktionerna och före footern', async () => {
    const { container } = renderLanding();
    await loaded();
    const follows = (earlier: Element, later: Element) => Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
    const hero = screen.getByRole('region', { name: 'Your group chat deserves a leaderboard' });
    const preview = screen.getByRole('region', { name: 'The leaderboard, live' });
    const features = screen.getByRole('region', { name: "What's in the game" });
    const film = container.querySelector('#film') as Element;
    const waitlist = container.querySelector('#waitlist') as Element;
    expect(follows(hero, film) && follows(film, preview)).toBe(true);
    expect(follows(features, waitlist) && follows(waitlist, screen.getByRole('contentinfo'))).toBe(true);
  });

  it('varje ankarlänk på landningen har ett mål', async () => {
    const { container } = renderLanding({ width: DESKTOP });
    await loaded();
    const anchors = [...container.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
    expect(anchors.map((anchor) => anchor.getAttribute('href')).sort()).toEqual(['#film', '#film', '#features', '#how-it-works', '#waitlist'].sort());
    for (const anchor of anchors) expect(container.querySelector(`[id="${anchor.getAttribute('href')?.slice(1)}"]`), anchor.getAttribute('href') ?? '').not.toBeNull();
  });
});

describe('Landing — innehåll', () => {
  // Tonen mellan headern och glöden är dekor under innehållet: ligger den i headern (eller efter innehållet) dämpar den hjältens rubrik.
  it('tonen under headern ligger före innehållet i trädet, så att texten ritas ovanpå den och aldrig dämpas', async () => {
    const { container } = renderLanding();
    await loaded();
    const fade = container.querySelector('[data-decor="fade"]') as HTMLElement;
    const inner = container.querySelector('.rq-landing__inner') as HTMLElement;
    expect(fade.compareDocumentPosition(inner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('banner').contains(fade)).toBe(false);
  });

  it('previewkortet visar fem förnamn med plats, XP och rankpilar som skärmläsare kan läsa', async () => {
    renderLanding();
    await loaded();
    const card = within(screen.getByRole('region', { name: 'The leaderboard, live' }));
    const rows = card.getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('.rq-name')?.textContent)).toEqual(['Anna', 'Erik', 'Maria', 'Johan', 'Sara']);
    expect(within(rows[0]).getByText('8 420', { exact: false })).toBeInTheDocument();
    expect(within(rows[0]).getByRole('img', { name: 'Up 1 place' })).toBeInTheDocument();
    expect(within(rows[1]).getByRole('img', { name: 'Down 1 place' })).toBeInTheDocument();
    expect(within(rows[2]).getByRole('img', { name: 'No change' })).toBeInTheDocument();
    expect(within(rows[3]).getByRole('img', { name: 'Up 2 places' })).toBeInTheDocument();
  });

  it('previewkortet heter Sample pack och är märkt som exempel, inte live', async () => {
    renderLanding();
    await loaded();
    const card = screen.getByRole('heading', { name: 'Sample pack' }).closest('section') as HTMLElement;
    expect(within(card).getByText('Example')).toBeInTheDocument();
    expect(screen.queryByText(/^live$/i)).toBeNull();
  });

  it('sidan nämner varken Wolfpack eller Göteborgsvarvet, och inga riktiga förnamn', async () => {
    const { container } = renderLanding({ width: DESKTOP });
    await loaded();
    expect(container.textContent).not.toMatch(/Wolfpack|Göteborgsvarvet|Gothenburg|\b(Karl|Joel|Adam|Nicklas|Daniel)\b/);
    expect(container.textContent).not.toMatch(/Lindqvist|Svensson|Johansson|Karlsson|Nilsson/);
  });

  it('previewkortet har ingen nedräkning', async () => {
    const { container } = renderLanding({ width: DESKTOP });
    await loaded();
    expect(screen.queryByText(/next event|evening run/i)).toBeNull();
    expect(container.textContent).not.toMatch(/\d+h\s*\d{2}m\s*\d{2}s/);
  });

  it('How it works har fyra steg i en lista med h3 per steg', async () => {
    renderLanding();
    await loaded();
    const how = within(screen.getByRole('region', { name: 'Four things decide your rank' }));
    const steps = how.getAllByRole('listitem');
    expect(steps).toHaveLength(4);
    expect(steps.map((step) => within(step).getByRole('heading', { level: 3 }).textContent)).toEqual(['Log the run', 'Earn XP', 'Keep the streak', 'Take the title']);
    expect(within(steps[1]).getByText(/Base 15 plus 2 per km/)).toBeInTheDocument();
    expect(within(steps[2]).getByText(/from day 5/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Four things decide your rank' })).toHaveAttribute('id', 'how-it-works');
  });

  it.each([[MOBILE], [DESKTOP]])('XP-formeln finns på både mobil och desktop (%i px)', async (width) => {
    renderLanding({ width });
    await loaded();
    const formula = within(screen.getByRole('group', { name: 'The XP formula, no secrets' }));
    expect(formula.getByText('Base 15')).toBeInTheDocument();
    expect(formula.getByText('km × 2')).toBeInTheDocument();
    expect(formula.getByText('Streak 1.0–2.0×')).toBeInTheDocument();
    expect(formula.getByText('A 10 km run today')).toBeInTheDocument();
    expect(formula.getByText('+50 XP')).toBeInTheDocument();
  });

  it('formeln har en textversion för skärmläsare', async () => {
    renderLanding();
    await loaded();
    const spoken = screen.getByText('Base 15 plus 2 per km plus distance bonus, times a streak multiplier from 1.0 to 2.0');
    expect(spoken).toHaveClass('sr-only');
  });

  it('desktop visar de tre förklaringarna bredvid kortet och mobil visar dem inte', async () => {
    const desktop = renderLanding({ width: DESKTOP });
    await loaded();
    expect(screen.getByText('Recurring events open on a schedule; join one and the XP lands on the board.')).toBeInTheDocument();
    desktop.unmount();
    renderLanding({ width: MOBILE });
    await loaded();
    expect(screen.queryByText(/Recurring events open on a schedule/)).toBeNull();
  });
});

describe('Landing — det enda anropet och siffrorna', () => {
  it('landningen hämtar bara /api/public/stats vid sidladdning', async () => {
    const { fetchSpy } = renderLanding({ width: DESKTOP });
    await loaded();
    await screen.findByText('4 551', { exact: false });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(new URL(url).pathname).toBe('/api/public/stats');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
  });

  it('sifferraden döljs vid fel och resten av sidan renderas', async () => {
    const { fetchSpy } = renderLanding({ width: DESKTOP, respond: () => new Response('{"error":"Failed"}', { status: 500 }) });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'RunQuest in numbers' })).toBeNull());
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('km logged')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Your group chat deserves a leaderboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Join the waitlist' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'The leaderboard, live' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Four things decide your rank' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: "What's in the game" })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('inga påhittade siffror och inget packs running-märke finns kvar', async () => {
    const { container } = renderLanding({ width: DESKTOP });
    await loaded();
    expect(container.textContent).not.toMatch(/packs? running/i);
    expect(container.textContent).not.toMatch(/128\s?430|9\s?412|1\s?284\s?600|\b14 packs\b/);
    expect(screen.queryByText(/xp awarded/i)).toBeNull();
  });

  it.each([MOBILE, DESKTOP])('sidan antyder inte att RunQuest är gratis (%i px): ingen text eller etikett nämner "free", men "No app to install" står kvar', async (width) => {
    const { container } = renderLanding({ width });
    await loaded();
    expect(container.textContent).not.toMatch(/free/i);
    const labelled = [...container.querySelectorAll('[aria-label], [title], [alt]')];
    expect(labelled.filter((element) => /free/i.test(`${element.getAttribute('aria-label')} ${element.getAttribute('title')} ${element.getAttribute('alt')}`))).toEqual([]);
    expect(screen.getByText('No app to install')).toBeInTheDocument();
  });
});
