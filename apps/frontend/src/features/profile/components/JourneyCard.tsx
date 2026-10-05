import { useState } from 'react';
import { JOURNEY_END_KM, journeyPercent, lastCheckpoint, nextCheckpointInfo, nextZoom, type ZoomLevel } from '../frodoModel';
import { FrodoRoad, ZoomButton } from './FrodoRoad';
import { formatInt } from '../profileFormat';
import { PanelHead } from './ProfileParts';

interface JourneyCardProps {
  totalKm: number;
  isDesktop: boolean;
}

/**
 * Frodo's journey: löparens totala km som vandring mot Mount Doom (3 266 km) med zoomknapp (Overview → Zoomed → Close-up)
 * på båda skärmstorlekarna. Mobil visar procent och nästa mål (App Prototype); desktop dessutom senaste checkpoint,
 * "away" och en ring där nästa checkpoint ligger (Web Prototype). Framme: målmeddelande och ingen zoomknapp.
 */
export function JourneyCard({ totalKm, isDesktop }: JourneyCardProps) {
  const [zoom, setZoom] = useState<ZoomLevel>(0);
  const done = totalKm >= JOURNEY_END_KM;
  const canZoom = !done && totalKm > 0;
  const percentText = `${journeyPercent(totalKm).toFixed(1)}%`;
  const checkpoint = lastCheckpoint(totalKm);
  const next = nextCheckpointInfo(totalKm);
  const progress = `${percentText} · ${formatInt(Math.min(totalKm, JOURNEY_END_KM))} / ${formatInt(JOURNEY_END_KM)} km`;

  const zoomButton = canZoom ? <ZoomButton zoom={zoom} onCycle={() => setZoom(nextZoom)} /> : undefined;

  return (
    <section className="rq-card rq-profile-journey" aria-label="Frodo's journey" data-tour="profile-journey">
      <PanelHead icon={isDesktop ? 'sparkles' : undefined} title="FRODO'S JOURNEY" note={isDesktop ? 'as Frodo' : undefined} aside={zoomButton} />

      <FrodoRoad prefix="profile" totalKm={totalKm} zoom={canZoom ? zoom : 0} showNext={isDesktop && !done} />

      {done ? (
        <p className="rq-profile-journey__sum" data-done="true">Mount Doom reached — the Ring is destroyed.</p>
      ) : (
        <>
          <p className="rq-profile-journey__sum">
            {isDesktop ? (
              <>
                <span><span className="rq-profile-journey__pin" aria-hidden="true" />Last checkpoint <span className="rq-profile-journey__em">{checkpoint.name}</span></span>
                <span>{progress}</span>
              </>
            ) : (
              <span>{progress}</span>
            )}
          </p>
          {next && (
            <p className="rq-profile-journey__sum" data-next="true">
              <span>
                {isDesktop && <span className="rq-profile-journey__pin" data-pin="next" aria-hidden="true" />}
                Next <span className="rq-profile-journey__em">{next.name} — {formatInt(next.remaining)} km{isDesktop ? ' away' : ''}</span>
              </span>
            </p>
          )}
        </>
      )}
    </section>
  );
}
