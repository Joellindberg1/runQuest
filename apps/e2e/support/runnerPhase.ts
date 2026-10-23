import type { Page } from '@playwright/test';

// Hjälpare som följer var i varvet stadion-ovalens löparprickar står i varje ritad bildruta, genom alla byten av laddare (index.html, React, gaten) och mellan dokument
// (TrackLoader, loaders/runnerPhase.ts). Specen som använder den: tests/loader-continuity.spec.ts.

/** Laddningsvyns oval (192 px), utpekad som övriga specer gör. */
export const LOADING_VIEW_STATUS = '.rq-shell__pending [role="status"]';

/** En prickes läge i en ritad bildruta. */
export interface RunnerSample {
  /** Väggklocka (ms) för bildrutan: dokumentets `performance.timeOrigin` plus rAF-tidsstämpeln, som animationerna själva läser. Jämförbar mellan dokument. */
  at: number;
  /** Vilken laddare (DOM-nod) pricken tillhör: ett nytt värde = ett byte. Unikt över dokument. */
  loader: string;
  /** Banan, 0 = yttersta. */
  lane: number;
  /** Andel av prickens varv, 0 till 1: `getComputedTiming().progress` hos animationen `rqOrbit`. */
  progress: number;
  /** Prickens varvtid i ms. */
  lapMs: number;
  /** Prickens animationsfördröjning i ms (negativ: TrackLoader skjuter varje bana -i * 0,7 s fram). */
  delayMs: number;
  /** Banans längd i skärm-px (rigid transform, så samma som prickens väg). */
  lapPx: number;
}

export interface RunnerPhaseLog {
  samples: () => RunnerSample[];
}

/**
 * Loggar prickarnas läge i varje bildruta från dokumentets start, i varje dokument sidan laddar (som `logFrames`). Mäter bara i bildrutor som ritas, alltså efter att
 * stilen är tillämpad (ritningen väntar på stilmallarna). Animationer som ännu inte har en starttid (`progress` är null) hoppas över.
 */
export async function logRunnerPhases(page: Page, scope: string = LOADING_VIEW_STATUS): Promise<RunnerPhaseLog> {
  const samples: RunnerSample[] = [];
  await page.exposeFunction('__rqReportRunners', (batch: RunnerSample[]) => {
    samples.push(...batch);
  });
  await page.addInitScript((scopeSelector: string) => {
    const ids = new WeakMap<Element, string>();
    let next = 0;
    const tick = (frameTime: number) => {
      // Suspense låter en gömd laddare (0 x 0) ligga kvar i DOM:en bredvid den synliga: bara en som har en storlek ritas.
      const status = Array.from(document.querySelectorAll(scopeSelector)).find((candidate) => candidate.getBoundingClientRect().width > 0);
      if (status) {
        if (!ids.has(status)) ids.set(status, `${performance.timeOrigin}:${next++}`);
        const dots = Array.from(status.querySelectorAll<HTMLElement>(':scope > div[aria-hidden="true"]'));
        const lanes = Array.from(status.querySelectorAll<SVGPathElement>('svg path'));
        const batch: unknown[] = [];
        dots.forEach((dot, lane) => {
          // En dold prick syns inte: index.html döljer dem tills de ligger på klockan (runnerPhase.ts), och en dold bildruta räknas inte.
          if (getComputedStyle(dot).visibility === 'hidden') return;
          const orbit = dot.getAnimations().find((animation) => (animation as CSSAnimation).animationName === 'rqOrbit');
          const timing = orbit?.effect?.getComputedTiming();
          const path = lanes[lane];
          const matrix = path?.getScreenCTM();
          if (!timing || timing.progress == null || !path || !matrix) return;
          batch.push({
            at: performance.timeOrigin + frameTime,
            loader: ids.get(status),
            lane,
            progress: timing.progress,
            lapMs: Number(timing.duration),
            delayMs: Number(timing.delay),
            lapPx: path.getTotalLength() * Math.hypot(matrix.a, matrix.b),
          });
        });
        if (batch.length > 0) (window as unknown as { __rqReportRunners: (batch: unknown[]) => void }).__rqReportRunners(batch);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, scope);
  return { samples: () => [...samples] };
}

/** Hur långt en prick hoppade mellan två bildrutor, utöver det den skulle ha rört sig på tiden. */
export interface RunnerHop {
  lane: number;
  /** Absolut avvikelse i px längs banan. */
  px: number;
  /** Mellan vilka laddare det hände: samma värde = ingen nod byttes. */
  fromLoader: string;
  toLoader: string;
  /** Sant om de två bildrutorna ritades i olika dokument (en ny sidladdning, inte bara en ny nod). */
  acrossDocuments: boolean;
}

/** Dokumentet en laddare hör till (`performance.timeOrigin` före kolonet i laddarens id). */
const documentOf = (loader: string): string => loader.split(':')[0] ?? loader;

/** Längsta mellanrum mellan två bildrutor som ännu går att jämföra: över ett halvt varv går en framflyttning inte att skilja från en bakåtflyttning. */
const MAX_COMPARABLE_GAP_FRACTION = 0.4;

/**
 * Jämför varje prick med sin föregående bildruta (samma bana, tidsordnat över alla laddare och dokument): hoppet är hur mycket andelen av varvet avviker från
 * "föregående andel plus tiden som gått", omräknat till px längs banan. En prick som fortsätter på klockan ger ca 0 px (bildrutornas tidsstämplar är animationens egen tid);
 * en animation som börjar om på 0 vid ett byte ger upp till ett halvt varv (ca 95 px i 192 px-ovalen).
 */
export function runnerHops(samples: readonly RunnerSample[]): RunnerHop[] {
  const hops: RunnerHop[] = [];
  const lanes = new Set(samples.map((sample) => sample.lane));
  for (const lane of lanes) {
    const ordered = samples.filter((sample) => sample.lane === lane).sort((a, b) => a.at - b.at);
    for (let index = 1; index < ordered.length; index += 1) {
      const before = ordered[index - 1]!;
      const after = ordered[index]!;
      const gap = after.at - before.at;
      if (gap <= 0 || gap > MAX_COMPARABLE_GAP_FRACTION * after.lapMs) continue;
      const error = after.progress - (before.progress + gap / after.lapMs);
      const wrapped = error - Math.round(error);
      hops.push({
        lane,
        px: Math.abs(wrapped) * after.lapPx,
        fromLoader: before.loader,
        toLoader: after.loader,
        acrossDocuments: documentOf(before.loader) !== documentOf(after.loader),
      });
    }
  }
  return hops;
}

/** En ritad pricks avstånd från sin plats på klockan. */
export interface ClockError {
  lane: number;
  px: number;
}

/**
 * Hur långt varje ritad prick ligger från platsen klockan ger den: andelen av varvet ska vara `((väggklocka - fördröjning) / varvtid) mod 1`, alltså samma plats i varje
 * dokument och nod. Till skillnad från `runnerHops` (som jämför en bildruta med den förra) fångar det en prick som aldrig hoppar men hela tiden ligger fel, till exempel en som
 * skapades senare än de andra och började på sin egen nolla.
 */
export function runnerClockErrors(samples: readonly RunnerSample[]): ClockError[] {
  return samples.map((sample) => {
    const expected = (((sample.at - sample.delayMs) / sample.lapMs) % 1 + 1) % 1;
    const error = sample.progress - expected;
    return { lane: sample.lane, px: Math.abs(error - Math.round(error)) * sample.lapPx };
  });
}

/** Hur många olika laddare (DOM-noder) som visat prickar: ett byte per ny. */
export function loaderCount(samples: readonly RunnerSample[]): number {
  return new Set(samples.map((sample) => sample.loader)).size;
}
