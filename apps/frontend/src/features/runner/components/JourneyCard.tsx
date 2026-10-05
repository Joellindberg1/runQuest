import { useState } from 'react';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { cssVars } from '@/features/leaderboard/cssVars';
import { formatInt } from '@/features/leaderboard/boardFormat';
import { JOURNEY_END_KM, journeyPercent, lastCheckpoint, nextZoom, type ZoomLevel } from '@/features/profile/frodoModel';
import { FrodoRoad, ZoomButton } from '@/features/profile/components/FrodoRoad';
import { PanelHead } from './RunnerParts';

/** Mobil: en enkel stapel (App Prototype). Fylls från noll en gång, sedan stilla. */
function SimpleRoad({ percent }: { percent: number }) {
  return (
    <>
      <div
        className="rq-track rq-runner-track"
        role="progressbar"
        aria-label="Progress to Mount Doom"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        style={cssVars({ '--w': `${percent}%` })}
      >
        <div className="rq-fill" />
        <span className="rq-runner-knob" aria-hidden="true" />
      </div>
      <div className="rq-runner-ends">
        <span data-end="start">Shire</span>
        <span>Moria</span>
        <span data-end="finish">Mordor</span>
      </div>
    </>
  );
}

/** Frodo's journey: löparens totala km som vandring mot Mount Doom (3 266 km), med senaste checkpoint. */
export function JourneyCard({ totalKm }: { totalKm: number }) {
  const isDesktop = useIsDesktop() === true;
  const [zoom, setZoom] = useState<ZoomLevel>(0);
  const percent = journeyPercent(totalKm);
  const checkpoint = lastCheckpoint(totalKm);
  const done = totalKm >= JOURNEY_END_KM;
  const canZoom = isDesktop && !done && totalKm > 0;
  const percentText = `${percent.toFixed(1)}%`;
  // Desktop: zoomknappen. Mobil: bara procenten (App Prototype). Desktop utan något att zooma (0 km / framme): ingenting.
  const zoomButton = <ZoomButton zoom={zoom} onCycle={() => setZoom(nextZoom)} />;
  const aside = isDesktop ? (canZoom ? zoomButton : undefined) : percentText;

  return (
    <section className="rq-card rq-runner-journey" aria-label="Frodo's journey">
      <PanelHead
        icon={isDesktop ? 'sparkles' : undefined}
        title="FRODO'S JOURNEY"
        aside={aside}
      />

      {isDesktop ? <FrodoRoad prefix="runner" totalKm={totalKm} zoom={canZoom ? zoom : 0} /> : <SimpleRoad percent={percent} />}

      {done ? (
        <p className="rq-runner-journey__sum" data-done="true">Mount Doom reached — the Ring is destroyed.</p>
      ) : (
        <p className="rq-runner-journey__sum">
          <span>Last checkpoint <span className="rq-runner-journey__cp">{checkpoint.name}</span></span>
          {isDesktop && <span>{percentText} · {formatInt(totalKm)} / {formatInt(JOURNEY_END_KM)} km</span>}
        </p>
      )}
    </section>
  );
}
