import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { track } from '@/shared/analytics/track';
import { LandingFilm, WatchFilmButton } from './LandingFilm';

vi.mock('@/shared/analytics/track', () => ({ track: vi.fn() }));

// Spelaren gör inga anrop och startar aldrig av sig själv. jsdom spelar ingen video, så play/pause/load är spioner och mediehändelserna
// (playing, pause, ended, timeupdate, error) skickas för hand, i samma ordning som webbläsaren skickar dem.
// user-event är inget beroende i repot (och nya beroenden kräver Lead), så fireEvent används: play och paus är riktiga <button>,
// som webbläsaren själv gör till klick vid Enter och mellanslag.

const PLAY_LABEL = 'Play the RunQuest film, 49 seconds, no sound';
const PAUSE_LABEL = 'Pause the film';

let playSpy: ReturnType<typeof vi.spyOn>;
let pauseSpy: ReturnType<typeof vi.spyOn>;
let loadSpy: ReturnType<typeof vi.spyOn>;
let currentTime = 0;

function stubViewport(width: number, { reducedMotion = false }: { reducedMotion?: boolean } = {}) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const matches = /prefers-reduced-motion:\s*reduce/.test(query) ? reducedMotion : min ? width >= Number(min[1]) : false;
    return { matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  });
  window.matchMedia = globalThis.matchMedia;
}

beforeEach(() => {
  currentTime = 0;
  playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  loadSpy = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
    configurable: true,
    get: () => currentTime,
    set: (value: number) => {
      currentTime = value;
    },
  });
  stubViewport(1440);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLMediaElement.prototype, 'currentTime');
});

const getVideo = (container: HTMLElement) => container.querySelector('video') as HTMLVideoElement;
// Knappen på postern: synlig text ("PLAY — 0:49" / "WATCH THE FILM — 0:49") och ett namn som börjar med den.
const POSTER_BUTTON_NAME = /^(?:play|watch the film) — 0:49: the RunQuest film, no sound$/i;
const playButton = () => screen.getByRole('button', { name: POSTER_BUTTON_NAME });

/** Klick på play och sedan första bildrutan: filmen spelar. */
function startFilm(container: HTMLElement) {
  fireEvent.click(playButton());
  fireEvent.playing(getVideo(container));
}

describe('filmen: innan den startar', () => {
  it('filmen hämtar ingenting innan play', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { container } = render(<LandingFilm variant="desktop" />);
    const video = getVideo(container);

    expect(video).toHaveAttribute('preload', 'none');
    expect(video).not.toHaveAttribute('autoplay');
    expect(video).not.toHaveAttribute('loop');
    expect(video).not.toHaveAttribute('controls');
    // Utan playsinline öppnar iOS filmen i helskärm i stället för i spelaren.
    expect(video).toHaveAttribute('playsinline');
    expect(video).not.toHaveAttribute('poster');
    expect(video).not.toHaveAttribute('src');
    expect(playSpy).not.toHaveBeenCalled();
    expect(loadSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('filmen väljer 720p från 1024 px och 480p under', () => {
    for (const variant of ['desktop', 'mobile'] as const) {
      stubViewport(variant === 'desktop' ? 1440 : 390);
      const { container, unmount } = render(<LandingFilm variant={variant} />);
      const sources = Array.from(container.querySelectorAll('video > source'));
      expect(sources.map((source) => [source.getAttribute('src'), source.getAttribute('media'), source.getAttribute('type')])).toEqual([
        ['/media/landing-film-720.v1.mp4', '(min-width: 1024px)', 'video/mp4'],
        ['/media/landing-film-480.v1.mp4', null, 'video/mp4'],
      ]);
      unmount();
    }
  });

  it('postern hämtas i mobilstorlek under 1024 px', () => {
    for (const [variant, width] of [['mobile', 390], ['desktop', 1440]] as const) {
      stubViewport(width);
      const { container, unmount } = render(<LandingFilm variant={variant} />);
      const picture = container.querySelector('picture') as HTMLElement;
      const source = picture.querySelector('source') as HTMLSourceElement;
      const image = picture.querySelector('img') as HTMLImageElement;
      expect(source).toHaveAttribute('media', '(min-width: 1024px)');
      expect(source).toHaveAttribute('srcset', '/media/landing-film-poster-720.v1.webp');
      expect(image).toHaveAttribute('src', '/media/landing-film-poster-480.v1.webp');
      expect(image).toHaveAttribute('width');
      expect(image).toHaveAttribute('height');
      unmount();
    }
  });

  it('spelaren saknar ljudknapp och texten sound on', () => {
    for (const [variant, width] of [['desktop', 1440], ['mobile', 390]] as const) {
      stubViewport(width);
      const { container, unmount } = render(<LandingFilm variant={variant} />);
      startFilm(container);
      expect(container.textContent).not.toMatch(/sound on/i);
      for (const button of screen.getAllByRole('button')) expect(button).not.toHaveAccessibleName(/\b(mute|unmute|volume|sound on)\b/i);
      unmount();
    }
  });

  it('play-knappens tillgängliga namn börjar med dess synliga text', () => {
    for (const [variant, width] of [['desktop', 1440], ['mobile', 390]] as const) {
      stubViewport(width);
      const { unmount } = render(<LandingFilm variant={variant} />);
      const button = playButton();
      const visibleText = (button.textContent ?? '').trim();
      expect(visibleText).toMatch(/0:49$/);
      const name = (button.getAttribute('aria-label') ?? '').toLowerCase();
      expect(name.startsWith(visibleText.toLowerCase())).toBe(true);
      unmount();
    }
  });

  it('spelaren och play-knappen har etiketter med filmens längd', () => {
    for (const [variant, width] of [['desktop', 1440], ['mobile', 390]] as const) {
      stubViewport(width);
      const { container, unmount } = render(<LandingFilm variant={variant} />);
      const video = getVideo(container);
      expect(playButton()).toBeInTheDocument();
      expect(video).toHaveAttribute('aria-label', PLAY_LABEL);
      const steps = document.getElementById(video.getAttribute('aria-describedby') ?? '');
      expect(steps).not.toBeNull();
      expect(within(steps as HTMLElement).getAllByRole('listitem')).toHaveLength(3);
      unmount();
    }
  });
});

describe('filmen: att spela', () => {
  it('filmen startar först vid klick, spelar inte i loop och återgår till postern', () => {
    const { container } = render(<LandingFilm variant="desktop" />);
    const video = getVideo(container);
    expect(playSpy).not.toHaveBeenCalled();

    fireEvent.click(playButton());
    expect(playSpy).toHaveBeenCalledTimes(1);
    fireEvent.playing(video);
    expect(screen.queryByRole('button', { name: PLAY_LABEL })).toBeNull();
    expect(container.querySelector('picture')).toBeNull();
    expect(screen.getByRole('button', { name: PAUSE_LABEL })).toBeInTheDocument();

    currentTime = 49;
    fireEvent.pause(video);
    fireEvent.ended(video);
    expect(playButton()).toBeInTheDocument();
    expect(container.querySelector('picture')).not.toBeNull();
    expect(video.loop).toBe(false);
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('knappen är upptagen medan filmen laddar och postern ligger kvar', () => {
    const { container } = render(<LandingFilm variant="desktop" />);
    expect(playButton()).not.toHaveAttribute('aria-busy', 'true');
    fireEvent.click(playButton());
    expect(playButton()).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('picture')).not.toBeNull();
    fireEvent.playing(getVideo(container));
    expect(container.querySelector('picture')).toBeNull();
  });

  it('play, paus och sökning går med tangentbordet', () => {
    const { container } = render(<LandingFilm variant="desktop" />);
    const video = getVideo(container);

    // Riktiga knappar nås med Tab och ger klick vid Enter/mellanslag; fokus kan därför läggas direkt på dem.
    playButton().focus();
    expect(playButton()).toHaveFocus();
    fireEvent.click(playButton());
    fireEvent.playing(video);
    // Fokus följer med när överlägget byts mot kontrollraden.
    expect(screen.getByRole('button', { name: PAUSE_LABEL })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: PAUSE_LABEL }));
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    fireEvent.pause(video);
    expect(screen.getByRole('button', { name: PLAY_LABEL })).toBeInTheDocument();

    const slider = screen.getByRole('slider');
    // Reglaget nås med Tab: ett tabindex under noll skulle ta det ur tangentbordsordningen.
    expect(slider.tabIndex).toBeGreaterThanOrEqual(0);
    expect(screen.getByRole('button', { name: PLAY_LABEL }).tabIndex).toBeGreaterThanOrEqual(0);
    currentTime = 20;
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(video.currentTime).toBe(25);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(video.currentTime).toBe(15);
    currentTime = 3;
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(video.currentTime).toBe(0);
    currentTime = 47;
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(video.currentTime).toBe(49);
  });

  it('sökreglaget följer tiden och läses upp som minuter och sekunder av hela filmen', () => {
    const { container } = render(<LandingFilm variant="desktop" />);
    startFilm(container);
    const slider = screen.getByRole('slider', { name: /seek/i });
    expect(slider).toHaveAttribute('aria-valuetext', '0:00 of 0:49');
    expect(screen.getByText('0:00 / 0:49')).toBeInTheDocument();

    currentTime = 12.4;
    fireEvent.timeUpdate(getVideo(container));
    expect(slider).toHaveAttribute('aria-valuetext', '0:12 of 0:49');
    expect(screen.getByText('0:12 / 0:49')).toBeInTheDocument();

    fireEvent.change(slider, { target: { value: '30' } });
    expect(getVideo(container).currentTime).toBe(30);
    expect(slider).toHaveAttribute('aria-valuetext', '0:30 of 0:49');
  });

  it('på mobilen pausar och startar tryck på filmen, och knappen går att nå medan den spelar', () => {
    stubViewport(390);
    const { container } = render(<LandingFilm variant="mobile" />);
    const video = getVideo(container);
    expect(screen.queryByRole('slider')).toBeNull();

    playButton().focus();
    fireEvent.click(playButton());
    fireEvent.playing(video);
    const pause = screen.getByRole('button', { name: PAUSE_LABEL });
    expect(pause).toHaveFocus();
    expect(pause).toHaveAttribute('data-film-play');

    fireEvent.click(pause);
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    fireEvent.pause(video);
    fireEvent.click(screen.getByRole('button', { name: PLAY_LABEL }));
    expect(playSpy).toHaveBeenCalledTimes(2);
  });
});

describe('filmen: fel', () => {
  it('felläget visar postern och ett meddelande när filmen inte kan laddas', () => {
    const { container } = render(<LandingFilm variant="desktop" />);
    const video = getVideo(container);
    fireEvent.click(playButton());
    // Webbläsaren skickar error på 720p-källan när den inte passar media-frågan (telefon): det är inget fel.
    fireEvent.error(container.querySelector('video > source:first-of-type') as HTMLSourceElement);
    expect(screen.queryByRole('alert')).toBeNull();
    const lastSource = container.querySelector('video > source:last-of-type') as HTMLSourceElement;
    fireEvent.error(lastSource);

    expect(screen.getByRole('alert')).toHaveTextContent('The film could not load');
    expect(container.querySelector('picture')).not.toBeNull();
    expect(playButton()).not.toHaveAttribute('aria-busy', 'true');

    playSpy.mockClear();
    fireEvent.click(playButton());
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.playing(video);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ett mediafel på själva videon mitt i filmen ger samma felläge', () => {
    const { container } = render(<LandingFilm variant="desktop" />);
    const video = getVideo(container);
    startFilm(container);
    Object.defineProperty(video, 'error', { configurable: true, value: { code: 2 } });
    fireEvent.error(video);
    expect(screen.getByRole('alert')).toHaveTextContent('The film could not load');
    expect(playButton()).toBeInTheDocument();
  });

  it('en avvisad play() ger samma felläge, men en avbruten gör det inte', async () => {
    stubViewport(390);
    const { container } = render(<LandingFilm variant="mobile" />);
    playSpy.mockRejectedValueOnce(new DOMException('interrupted', 'AbortError'));
    fireEvent.click(playButton());
    await Promise.resolve();
    expect(screen.queryByRole('alert')).toBeNull();

    playSpy.mockRejectedValueOnce(new DOMException('no source', 'NotSupportedError'));
    fireEvent.click(playButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('The film could not load');
    expect(getVideo(container)).toBeInTheDocument();
  });
});

describe('filmen: en spelare per skärmbredd', () => {
  it('bara en spelare finns i tillgänglighetsträdet per skärmbredd', () => {
    for (const [width, expected] of [[1440, 'desktop'], [390, 'mobile']] as const) {
      stubViewport(width);
      const { container, unmount } = render(
        <>
          <LandingFilm variant="mobile" />
          <LandingFilm variant="desktop" />
        </>,
      );
      expect(container.querySelectorAll('#film')).toHaveLength(1);
      expect(container.querySelectorAll('video')).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: POSTER_BUTTON_NAME })).toHaveLength(1);
      expect(container.querySelector('#film')?.tagName).toBe(expected === 'desktop' ? 'SECTION' : 'DIV');
      unmount();
    }
  });

  it('renderar ingenting innan skärmbredden är känd', () => {
    vi.stubGlobal('matchMedia', undefined);
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    const { container } = render(<LandingFilm variant="desktop" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('filmen: desktopvyn och mobilvyn', () => {
  it('desktop: ögonbryn, rubrik, bildtext utan ljud och de tre stegen som lista', () => {
    render(<LandingFilm variant="desktop" />);
    const section = screen.getByRole('region', { name: 'From a run to a rank' });
    expect(section).toHaveAttribute('id', 'film');
    expect(within(section).getByText('Watch the film')).toBeInTheDocument();
    expect(within(section).getByRole('heading', { level: 2, name: 'From a run to a rank' })).toBeInTheDocument();
    expect(within(section).getByText('Strava syncs it — RunQuest scores it · 0:49')).toBeInTheDocument();
    expect(within(section).getByText('PLAY — 0:49')).toBeInTheDocument();
    const steps = within(section).getAllByRole('listitem');
    expect(steps.map((step) => step.textContent)).toEqual([
      '01Run — Strava imports it',
      '02Score — XP, streaks, bonuses',
      '03Reign — the standings move',
    ]);
  });

  it('mobil: liten play-ruta, ingen rubrik och stegen bara för skärmläsare', () => {
    stubViewport(390);
    const { container } = render(<LandingFilm variant="mobile" />);
    expect(container.querySelector('#film')?.tagName).toBe('DIV');
    expect(screen.getByText('WATCH THE FILM — 0:49')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
    const steps = document.getElementById(getVideo(container).getAttribute('aria-describedby') as string) as HTMLElement;
    expect(steps).toHaveClass('sr-only');
  });
});

describe('Watch the film', () => {
  it('Watch the film flyttar fokus till filmens play-knapp utan att starta filmen', () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    render(
      <>
        <WatchFilmButton />
        <LandingFilm variant="desktop" />
      </>,
    );
    const link = screen.getByRole('link', { name: 'Watch the film — 0:49' });
    expect(link).toHaveAttribute('href', '#film');
    expect(link).toHaveClass('rq-btn', 'rq-btn--ghost', 'rq-btn--lg');

    expect(fireEvent.click(link)).toBe(false); // preventDefault: ingen hashnavigering
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    expect(playButton()).toHaveFocus();
    expect(playSpy).not.toHaveBeenCalled();
  });

  it('scrollar direkt vid reducerad rörelse', () => {
    stubViewport(390, { reducedMotion: true });
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    render(
      <>
        <WatchFilmButton />
        <LandingFilm variant="mobile" />
      </>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Watch the film — 0:49' }));
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
    expect(playButton()).toHaveFocus();
    expect(playSpy).not.toHaveBeenCalled();
  });
});

describe('filmen: webbanalys', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
  });

  it('reports film-started once the film begins playing from the poster, and nothing at the click itself', async () => {
    const { container } = render(<LandingFilm variant="desktop" />);
    await userEvent.click(playButton());
    expect(track).not.toHaveBeenCalled();
    fireEvent.playing(getVideo(container));
    expect(track).toHaveBeenCalledExactlyOnceWith('film-started');
  });

  it('does not report again when the film is paused and resumed, or when it plays on after a seek', async () => {
    const { container } = render(<LandingFilm variant="desktop" />);
    await userEvent.click(playButton());
    fireEvent.playing(getVideo(container));
    await userEvent.click(screen.getByRole('button', { name: PAUSE_LABEL }));
    fireEvent.pause(getVideo(container));
    await userEvent.click(screen.getByRole('button', { name: PLAY_LABEL }));
    fireEvent.playing(getVideo(container));
    fireEvent.playing(getVideo(container));
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('reports again when the film is started anew after it has ended', async () => {
    const { container } = render(<LandingFilm variant="desktop" />);
    await userEvent.click(playButton());
    fireEvent.playing(getVideo(container));
    fireEvent.ended(getVideo(container));
    await userEvent.click(playButton());
    fireEvent.playing(getVideo(container));
    expect(track).toHaveBeenCalledTimes(2);
  });

  it('reports on the mobile layout too', async () => {
    stubViewport(390);
    const { container } = render(<LandingFilm variant="mobile" />);
    await userEvent.click(playButton());
    fireEvent.playing(getVideo(container));
    expect(track).toHaveBeenCalledExactlyOnceWith('film-started');
  });

  it('reports nothing when the film cannot be loaded', async () => {
    playSpy.mockRejectedValue(new DOMException('no source', 'NotSupportedError'));
    render(<LandingFilm variant="desktop" />);
    await userEvent.click(playButton());
    expect(track).not.toHaveBeenCalled();
  });
});

describe('filmen: rörelse', () => {
  it('play-ringen pulserar inte vid reducerad rörelse', () => {
    // Ringen är ett pseudoelement med rqPulse. Reducerad rörelse hanteras av temafilens globala regel (Stylelint vaktar att filen inte sätter egen
    // animation-duration eller !important), så det som återstår att pröva här är att den globala regeln täcker pseudoelementen.
    const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
    const filmCss = postcss.parse(read('../landingFilm.css'));
    const animatedSelectors: string[] = [];
    filmCss.walkDecls((decl) => {
      if (decl.prop === 'animation') {
        expect(decl.value).toMatch(/^rqPulse /);
        animatedSelectors.push((decl.parent as postcss.Rule).selector);
      }
    });
    expect(animatedSelectors.length).toBeGreaterThan(0);

    const theme = postcss.parse(read('../../../index.css'));
    let globalSelector = '';
    theme.walkAtRules('media', (media) => {
      if (!/prefers-reduced-motion:\s*reduce/.test(media.params)) return;
      media.walkRules((rule) => {
        if (rule.some((node) => node.type === 'decl' && node.prop === 'animation-duration')) globalSelector += `${rule.selector},`;
      });
    });
    expect(globalSelector).toContain('*');
    if (animatedSelectors.some((selector) => /::after/.test(selector))) expect(globalSelector).toContain('*::after');
    if (animatedSelectors.some((selector) => /::before/.test(selector))) expect(globalSelector).toContain('*::before');
  });
});
