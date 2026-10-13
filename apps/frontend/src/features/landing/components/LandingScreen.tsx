import { useMemo } from 'react';
import '@/features/leaderboard/board.css';
import { PREVIEW_RANK_DELTAS, PREVIEW_USERS } from '@/features/leaderboard/previewUsers';
import { FILM_ID, buildHowItWorks, buildPreviewRows, buildXpFormula } from '../landingModel';
import '../landing.css';
import { LandingFeatures } from './LandingFeatures';
import { LandingFooter } from './LandingFooter';
import { LandingHeader } from './LandingHeader';
import { HowItWorks, LandingHero, PackPreview } from './LandingParts';

/**
 * Den publika startsidan (ADR 006: `/` för utloggade). Innehållet är sant eller tydligt märkt exempel: spelreglerna läses ur shared,
 * flocken är påhittad ("Sample pack"), och de tre talen i hjälten kommer från GET /public/stats — sidans enda anrop. Mobil =
 * App Prototypens landing i en kolumn; desktop = Landing-designen (1440 px) med text | bana i hjälten.
 * Film och väntelista har egna platser nedan som Lead fyller vid integrationen.
 */
export function LandingScreen() {
  const previewRows = useMemo(() => buildPreviewRows(PREVIEW_USERS, PREVIEW_RANK_DELTAS), []);
  const steps = useMemo(() => buildHowItWorks(), []);
  const formula = useMemo(() => buildXpFormula(), []);

  return (
    <div className="rq-landing">
      <div className="rq-landing__grid" data-decor="grid" aria-hidden="true" />
      <div className="rq-landing__glow" data-decor="glow" aria-hidden="true" />
      <div className="rq-landing__inner">
        <LandingHeader />
        <main className="rq-landing-main">
          <LandingHero
            // PLATS (Lead): <WatchFilmButton /> ur ./LandingFilm ersätter länken (knappen bär samma klasser och hoppar till #film).
            watchFilm={<a href={`#${FILM_ID}`} className="rq-btn rq-btn--ghost rq-btn--lg">Watch the film — 0:49</a>}
            // PLATS (Lead): <LandingFilm variant="mobile" /> ur ./LandingFilm.
            mobileFilm={null}
          />
          {/* PLATS (Lead): <LandingFilm variant="desktop" /> ur ./LandingFilm (bär själv id="film"). */}
          <div id="film" data-slot="film" />
          <PackPreview rows={previewRows} />
          <HowItWorks steps={steps} formula={formula} />
          <LandingFeatures />
          {/* PLATS (Lead): <LandingWaitlist /> ur ./LandingWaitlist (bär själv id="waitlist"). */}
          <div id="waitlist" data-slot="waitlist" />
        </main>
        <LandingFooter />
      </div>
    </div>
  );
}
