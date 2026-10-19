import type { Page } from '@playwright/test';

// Hjälpare som mäter var stadion-ovalens löparprickar står jämfört med sina banlinjer (TrackLoader, loaders/track-geometry.ts).

/** Hur långt en prickes mitt ligger från sin banlinje i en given fas av varvet. */
export interface RunnerDeviation {
  /** Fasen av varvet, 0 till 1 (andel av prickens varvtid). */
  phase: number;
  /** Banan, 0 = yttersta. */
  lane: number;
  /** Kortaste avståndet i skärm-px mellan prickens mitt och banlinjen. Rotationen är rigid, så avståndet är detsamma i ovalens egna koordinater. */
  deviationPx: number;
}

/** Fyra faser som sprider prickarna över raksträckor och kurvor. */
export const LAP_PHASES = [0, 0.25, 0.5, 0.75] as const;

/**
 * Pausar prickarnas animationer i varje fas och mäter avståndet från prickens mitt till banans path. Banans punkter tas med `getPointAtLength` och förs till
 * skärmens koordinater med `getScreenCTM()`, som räknar med SVG:ns viewBox och laddarens lutning. Prickens mitt är mitten av dess rektangel (en cirkel, så rotationen
 * längs banan flyttar den inte). `scope` pekar ut laddarens `role="status"`. Animationerna lämnas pausade: anropa bara på en sida som sedan lämnas.
 */
export function measureRunnerDeviations(page: Page, scope: string, phases: readonly number[] = LAP_PHASES): Promise<RunnerDeviation[]> {
  return page.evaluate(
    ({ scope: scopeSelector, phases: lapPhases }) => {
      const status = document.querySelector(scopeSelector);
      if (!status) throw new Error(`no loader matches ${scopeSelector}`);
      const dots = Array.from(status.querySelectorAll<HTMLElement>(':scope > div[aria-hidden="true"]'));
      const lanes = Array.from(status.querySelectorAll<SVGPathElement>('svg path'));
      if (dots.length === 0 || dots.length !== lanes.length) throw new Error(`${dots.length} runners but ${lanes.length} lanes`);

      // Banlinjens punkter i skärmkoordinater (fasta, de rör sig inte med varvet).
      const SAMPLES = 2_000;
      const lanePoints = lanes.map((lane) => {
        const matrix = lane.getScreenCTM();
        if (!matrix) throw new Error('the lane has no screen transform');
        const total = lane.getTotalLength();
        return Array.from({ length: SAMPLES }, (_, index) => {
          const point = lane.getPointAtLength((index / SAMPLES) * total).matrixTransform(matrix);
          return { x: point.x, y: point.y };
        });
      });

      const result: { phase: number; lane: number; deviationPx: number }[] = [];
      for (const phase of lapPhases) {
        dots.forEach((dot, lane) => {
          for (const animation of dot.getAnimations()) {
            animation.pause();
            const duration = Number(animation.effect?.getComputedTiming().duration ?? 0);
            animation.currentTime = phase * duration;
          }
          const box = dot.getBoundingClientRect();
          const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          const nearest = Math.min(...(lanePoints[lane] ?? []).map((point) => Math.hypot(point.x - centre.x, point.y - centre.y)));
          result.push({ phase, lane, deviationPx: Math.round(nearest * 100) / 100 });
        });
      }
      return result;
    },
    { scope, phases },
  );
}
