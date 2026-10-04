import { useEffect, useState } from 'react';
import { COUNT_UP_MS, countUpProgress } from '../landingModel';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Framsteget 0 → 1 för uppräkningen av aggregaten. Går EN gång när sidan visas (designspråk regel 8: tal och staplar
 * växer en gång och står sedan still). Med reducerad rörelse hoppar den direkt till 1, så slutvärdena visas utan animation.
 */
export function useCountUp(durationMs: number = COUNT_UP_MS): number {
  const [progress, setProgress] = useState(() => (prefersReducedMotion() ? 1 : 0));

  useEffect(() => {
    if (prefersReducedMotion()) {
      setProgress(1);
      return;
    }
    let frame = 0;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const next = countUpProgress(now - startedAt, durationMs);
      setProgress(next);
      if (next < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [durationMs]);

  return progress;
}
