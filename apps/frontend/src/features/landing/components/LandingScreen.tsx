import { useMemo } from 'react';
import '@/features/leaderboard/board.css';
import { PREVIEW_RANK_DELTAS, PREVIEW_USERS } from '@/features/leaderboard/previewUsers';
import { RQLogo } from '@/shared/components/icons';
import { buildHowItWorks, buildPreviewRows } from '../landingModel';
import '../landing.css';
import { HowItWorks, LandingHero, LandingStats, PackPreview } from './LandingParts';

/**
 * Den publika startsidan (ADR 006: `/` för utloggade). Ägarbeslut 4: allt innehåll är hårdskriven exempeldata —
 * inga anrop. Mobil = App Prototypens landing i en kolumn; desktop (Web Prototype saknar landing) = samma komposition
 * med text | bana i hjälten och preview | steg bredvid varandra.
 */
export function LandingScreen() {
  const previewRows = useMemo(() => buildPreviewRows(PREVIEW_USERS, PREVIEW_RANK_DELTAS), []);
  const steps = useMemo(() => buildHowItWorks(), []);

  return (
    <div className="rq-landing">
      <div className="rq-landing__glow" aria-hidden="true" />
      <div className="rq-landing__inner">
        <header className="rq-landing-header">
          <RQLogo className="rq-landing-logo" />
        </header>
        <main className="rq-landing-main">
          <LandingHero />
          <LandingStats />
          <div className="rq-landing-body">
            <PackPreview rows={previewRows} />
            <HowItWorks steps={steps} />
          </div>
        </main>
        <footer className="rq-landing-footer">
          <p>Run · Rank · Reign</p>
        </footer>
      </div>
    </div>
  );
}
