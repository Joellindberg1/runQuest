import { useMemo } from 'react';
import '@/features/leaderboard/board.css';
import { PREVIEW_RANK_DELTAS, PREVIEW_USERS } from '@/features/leaderboard/previewUsers';
import { buildHowItWorks, buildPreviewRows, buildXpFormula } from '../landingModel';
import '../landing.css';
import { LandingFeatures } from './LandingFeatures';
import { LandingFilm, WatchFilmButton } from './LandingFilm';
import { LandingFooter } from './LandingFooter';
import { LandingHeader } from './LandingHeader';
import { HowItWorks, LandingHero, PackPreview } from './LandingParts';
import { LandingWaitlist } from './LandingWaitlist';

/**
 * Den publika startsidan (ADR 006: `/` för utloggade). Innehållet är sant eller tydligt märkt exempel: spelreglerna läses ur shared,
 * flocken är påhittad ("Sample pack"), och de tre talen i hjälten kommer från GET /public/stats — sidans enda anrop. Mobil =
 * App Prototypens landing i en kolumn; desktop = Landing-designen (1440 px) med text | bana i hjälten.
 * Filmen (RUN-257) och väntelistan (RUN-211) är egna komponenter; filmen renderar bara den variant som passar bredden.
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
          <LandingHero watchFilm={<WatchFilmButton />} mobileFilm={<LandingFilm variant="mobile" />} />
          <LandingFilm variant="desktop" />
          <PackPreview rows={previewRows} />
          <HowItWorks steps={steps} formula={formula} />
          <LandingFeatures />
          <LandingWaitlist />
        </main>
        <LandingFooter />
      </div>
    </div>
  );
}
