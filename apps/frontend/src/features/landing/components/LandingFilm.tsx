import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import { cssVars } from '@/features/leaderboard/cssVars';
import { track } from '@/shared/analytics/track';
import { prefersReducedMotion } from '@/shared/utils/prefersReducedMotion';
import { FILM_ID, FILM_MOBILE_ID } from '../landingModel';
import '../landingFilm.css';

// Filmen "RunQuest Mixed" (49 s, inget ljudspår, påhittade namn). Den startar först vid tryck på play (preload="none", ingen autoplay, ingen
// loop) och när den spelat klart återgår spelaren till postern. Komponenten gör inga anrop. Filerna ligger i public/media och har versionen i
// namnet: en ny kodning får ett nytt namn, så den immutable-cachade filen aldrig skrivs över (se README, "Filmen, ikonerna och delningsbilden").

const FILM_SECONDS = 49;
const SEEK_STEP_SECONDS = 5;
const DESKTOP_MEDIA = '(min-width: 1024px)';
const FILM_720 = '/media/landing-film-720.v1.mp4';
const FILM_480 = '/media/landing-film-480.v1.mp4';
const POSTER_720 = '/media/landing-film-poster-720.v1.webp';
const POSTER_480 = '/media/landing-film-poster-480.v1.webp';
const POSTER_480_WIDTH = 854;
const POSTER_480_HEIGHT = 480;

const PLAY_LABEL = `Play the RunQuest film, ${FILM_SECONDS} seconds, no sound`;
// Knapparna på postern har synlig text ("PLAY — 0:49"). Skärmläsarnamnet börjar med exakt den texten (WCAG 2.5.3, Label in Name) och lägger
// tilläggsinfon efter. Knappar utan synlig text (kontrollraden, mobilknappen mitt i filmen) behåller PLAY_LABEL.
const POSTER_LABEL_TAIL = 'the RunQuest film, no sound';
const DESKTOP_POSTER_TEXT = `PLAY — ${formatClock(FILM_SECONDS)}`;
const MOBILE_POSTER_TEXT = `WATCH THE FILM — ${formatClock(FILM_SECONDS)}`;
const DESKTOP_POSTER_LABEL = `${DESKTOP_POSTER_TEXT}: ${POSTER_LABEL_TAIL}`;
const MOBILE_POSTER_LABEL = `${MOBILE_POSTER_TEXT}: ${POSTER_LABEL_TAIL}`;
const PAUSE_LABEL = 'Pause the film';
const SEEK_LABEL = 'Seek in the film';
const ERROR_TEXT = 'The film could not load';

const STEPS = [
  { number: '01', text: 'Run — Strava imports it' },
  { number: '02', text: 'Score — XP, streaks, bonuses' },
  { number: '03', text: 'Reign — the standings move' },
] as const;

type FilmStatus = 'idle' | 'loading' | 'playing' | 'paused';

/** 0:12 — hela sekunder, aldrig längre än filmen. */
function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.min(FILM_SECONDS, Math.floor(seconds)));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

const FILM_LENGTH = formatClock(FILM_SECONDS);

function useFilmPlayer() {
  const rootRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<FilmStatus>('idle');
  const [time, setTime] = useState(0);
  const [failed, setFailed] = useState(false);
  const needsRefocus = useRef(false);
  const retryNeedsLoad = useRef(false);

  // Knappen som hade fokus byts ut när spelaren byter läge (överlägget mot kontrollraden och tillbaka): fokus följer med till
  // den första play/paus-knappen i stället för att hamna på <body>.
  useEffect(() => {
    if (!needsRefocus.current) return;
    needsRefocus.current = false;
    rootRef.current?.querySelector<HTMLElement>('[data-film-play]')?.focus();
  }, [status]);

  const keepFocus = () => {
    needsRefocus.current = !!rootRef.current?.contains(document.activeElement);
  };

  const fail = useCallback(() => {
    retryNeedsLoad.current = true;
    setFailed(true);
    setStatus('idle');
  }, []);

  const play = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (retryNeedsLoad.current) {
      // Efter ett fel väljer webbläsaren inte källa på nytt av sig själv.
      retryNeedsLoad.current = false;
      video.load();
    }
    setFailed(false);
    setStatus((current) => (current === 'idle' ? 'loading' : current));
    Promise.resolve(video.play()).catch((reason: unknown) => {
      // En paus mitt i starten avbryter play(); det är inget fel.
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      fail();
    });
  }, [fail]);

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (status === 'playing') video.pause();
    else play();
  }, [play, status]);

  const seekTo = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const target = Math.max(0, Math.min(FILM_SECONDS, seconds));
    video.currentTime = target;
    setTime(target);
  }, []);

  const onSliderKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
    if (direction === 0 || !videoRef.current) return;
    event.preventDefault();
    seekTo(videoRef.current.currentTime + direction * SEEK_STEP_SECONDS);
  };

  const videoHandlers = {
    onPlaying: () => {
      keepFocus();
      // 'loading' sätts bara av ett tryck på play från postern: en återupptagen paus och en sökning ger 'paused'/'playing' och räknas inte.
      if (status === 'loading') track('film-started');
      setFailed(false);
      setStatus('playing');
    },
    // Webbläsaren skickar pause strax före ended; den sista pausen räknas inte som en paus.
    onPause: (event: { currentTarget: HTMLVideoElement }) => {
      if (!event.currentTarget.ended) setStatus('paused');
    },
    onEnded: (event: { currentTarget: HTMLVideoElement }) => {
      keepFocus();
      event.currentTarget.currentTime = 0;
      setTime(0);
      setStatus('idle');
    },
    onTimeUpdate: (event: { currentTarget: HTMLVideoElement }) => setTime(event.currentTarget.currentTime),
    // React skickar även <source>-fel hit. Webbläsaren skickar error på varje källa som inte passar media-frågan (720p på en telefon), och det är
    // inget fel: bara <video> självt (med ett MediaError) eller den sista källan räknas.
    onError: (event: { target: EventTarget; currentTarget: HTMLVideoElement }) => {
      if (event.target === event.currentTarget && event.currentTarget.error) fail();
    },
  };

  return { rootRef, videoRef, status, time, failed, play, toggle, seekTo, onSliderKeyDown, videoHandlers, fail };
}

type FilmPlayer = ReturnType<typeof useFilmPlayer>;

function FilmVideo({ player, stepsId, toggleOnClick }: { player: FilmPlayer; stepsId: string; toggleOnClick: boolean }) {
  return (
    <video
      ref={player.videoRef}
      className="rq-film__video"
      preload="none"
      playsInline
      aria-label={PLAY_LABEL}
      aria-describedby={stepsId}
      onClick={toggleOnClick ? player.toggle : undefined}
      {...player.videoHandlers}
    >
      <source src={FILM_720} media={DESKTOP_MEDIA} type="video/mp4" />
      {/* Reserven utan media: när alla källor fallerar skickas error på den sista <source>, inte på <video>. */}
      <source src={FILM_480} type="video/mp4" onError={player.fail} />
    </video>
  );
}

/** Postern: mobilen hämtar bara 480-filen. Dekor — knappens etikett beskriver filmen. */
function FilmPoster() {
  return (
    <picture className="rq-film__poster">
      <source media={DESKTOP_MEDIA} srcSet={POSTER_720} />
      <img src={POSTER_480} alt="" width={POSTER_480_WIDTH} height={POSTER_480_HEIGHT} loading="lazy" decoding="async" />
    </picture>
  );
}

function FilmSteps({ id, className }: { id: string; className: string }) {
  return (
    <ol id={id} className={className} role="list">
      {STEPS.map((step) => (
        <li key={step.number} className="rq-film__step">
          <span className="rq-film__step-num" aria-hidden="true">
            {step.number}
          </span>
          <span>{step.text}</span>
        </li>
      ))}
    </ol>
  );
}

function FilmError({ failed }: { failed: boolean }) {
  return failed ? (
    <p role="alert" className="rq-film__error">
      {ERROR_TEXT}
    </p>
  ) : null;
}

function DesktopFilm() {
  const player = useFilmPlayer();
  const stepsId = useId();
  const titleId = useId();
  const { status, time } = player;
  const showPoster = status === 'idle' || status === 'loading';
  const playing = status === 'playing';

  return (
    <section id={FILM_ID} ref={player.rootRef} className="rq-film rq-film--desktop" aria-labelledby={titleId}>
      <div className="rq-film__head">
        <div>
          <p className="rq-film__eyebrow">Watch the film</p>
          <h2 id={titleId} className="rq-film__title">
            From a run to a rank
          </h2>
        </div>
        <p className="rq-film__aside">{`Strava syncs it — RunQuest scores it · ${FILM_LENGTH}`}</p>
      </div>

      <div className="rq-film__player">
        <span className="rq-film__corner" data-corner="tl" aria-hidden="true" />
        <span className="rq-film__corner" data-corner="tr" aria-hidden="true" />
        <span className="rq-film__corner" data-corner="bl" aria-hidden="true" />
        <span className="rq-film__corner" data-corner="br" aria-hidden="true" />
        <div className="rq-film__stage">
          <FilmVideo player={player} stepsId={stepsId} toggleOnClick />
          {showPoster && <FilmPoster />}
          {showPoster && (
            <button type="button" className="rq-film__overlay" data-film-play aria-label={DESKTOP_POSTER_LABEL} aria-busy={status === 'loading'} onClick={player.play}>
              <span className="rq-film__play-box" aria-hidden="true">
                <span className="rq-film__glyph rq-film__glyph--play" />
              </span>
              <span className="rq-film__play-label" aria-hidden="true">{DESKTOP_POSTER_TEXT}</span>
            </button>
          )}
          <FilmError failed={player.failed} />
        </div>
        {/* Kontrollraden ligger under bilden, inte över den: filmen har inbränd text längst ned. Raden finns alltid så att höjden inte hoppar vid play. */}
        <div className="rq-film__bar">
          {!showPoster && (
            <>
              <button type="button" className="rq-film__btn" data-film-play aria-label={playing ? PAUSE_LABEL : PLAY_LABEL} onClick={player.toggle}>
                <span className={`rq-film__glyph rq-film__glyph--${playing ? 'pause' : 'play'}`} aria-hidden="true" />
              </button>
              <span className="rq-film__time" aria-hidden="true">{`${formatClock(time)} / ${FILM_LENGTH}`}</span>
              <input
                type="range"
                className="rq-film__range"
                aria-label={SEEK_LABEL}
                aria-valuetext={`${formatClock(time)} of ${FILM_LENGTH}`}
                min={0}
                max={FILM_SECONDS}
                step={1}
                value={Math.floor(time)}
                style={cssVars({ '--rq-film-progress': `${(Math.min(time, FILM_SECONDS) / FILM_SECONDS) * 100}%` })}
                onChange={(event: ChangeEvent<HTMLInputElement>) => player.seekTo(Number(event.target.value))}
                onKeyDown={player.onSliderKeyDown}
              />
            </>
          )}
        </div>
      </div>

      <FilmSteps id={stepsId} className="rq-film__steps" />
    </section>
  );
}

function MobileFilm() {
  const player = useFilmPlayer();
  const stepsId = useId();
  const { status, time } = player;
  const showPoster = status === 'idle' || status === 'loading';
  const playing = status === 'playing';

  return (
    <div id={FILM_MOBILE_ID} ref={player.rootRef as RefObject<HTMLDivElement>} className="rq-film rq-film--mobile">
      <div className="rq-film__stage">
        <FilmVideo player={player} stepsId={stepsId} toggleOnClick={false} />
        {showPoster && <FilmPoster />}
        {/* En enda knapp över hela rutan: tryck på filmen pausar och startar, och knappen finns kvar medan filmen spelar. */}
        <button
          type="button"
          className="rq-film__toggle"
          data-film-play
          aria-label={playing ? PAUSE_LABEL : showPoster ? MOBILE_POSTER_LABEL : PLAY_LABEL}
          aria-busy={status === 'loading'}
          onClick={player.toggle}
        >
          {showPoster && (
            <>
              <span className="rq-film__play-box" aria-hidden="true">
                <span className="rq-film__glyph rq-film__glyph--play" />
              </span>
              <span className="rq-film__play-label" aria-hidden="true">{MOBILE_POSTER_TEXT}</span>
            </>
          )}
        </button>
        <FilmError failed={player.failed} />
        {!showPoster && (
          <div className="rq-film__progress" aria-hidden="true" style={cssVars({ '--rq-film-progress': `${(Math.min(time, FILM_SECONDS) / FILM_SECONDS) * 100}%` })} />
        )}
      </div>
      <FilmSteps id={stepsId} className="sr-only" />
    </div>
  );
}

/**
 * Filmen i en av två vyer. Båda ligger i HTML (förrenderingen vet inte skärmbredden) och CSS döljer den som inte passar: desktop syns från
 * 1024 px, mobil under. Den dolda är display: none, alltså utanför tillgänglighetsträdet och tab-ordningen, och hämtar ingenting (preload="none",
 * lat poster). Varje vy har eget ankar-id (`film` / `film-mobile`). Lead monterar desktop på A:s plats för filmen och mobil i hjältens `mobileFilm`.
 */
export function LandingFilm({ variant }: { variant: 'desktop' | 'mobile' }) {
  return variant === 'desktop' ? <DesktopFilm /> : <MobileFilm />;
}

/** Filmen som syns just nu: den vars ankare CSS inte har dolt (en dold vy har inga rutor). Undviker att välja på bredd i JS. */
function visibleFilm(): HTMLElement | undefined {
  return [FILM_ID, FILM_MOBILE_ID]
    .map((id) => document.getElementById(id))
    .find((film): film is HTMLElement => film !== null && film.getClientRects().length > 0);
}

/** "Watch the film" i hjälten: scrollar till filmen som syns och lägger fokus på dess play-knapp. Filmen startar inte. */
export function WatchFilmButton() {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const film = visibleFilm();
    if (!film) return;
    event.preventDefault();
    film.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    // preventScroll: annars hoppar fokuseringen och avbryter den mjuka scrollen.
    film.querySelector<HTMLElement>('[data-film-play]')?.focus({ preventScroll: true });
  };

  return (
    <a href={`#${FILM_ID}`} className="rq-btn rq-btn--ghost rq-btn--lg" onClick={onClick}>
      {`Watch the film — ${FILM_LENGTH}`}
    </a>
  );
}
