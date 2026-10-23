import { expect, test } from '../support/test';
import { delayAppScript } from '../support/loadingView';
import { LOADING_VIEW_STATUS } from '../support/runnerPhase';

// Med minskad rörelse ska laddningsvyns prickar synas som förut (stilla på sin plats): index.html väntar bara på prickarnas fas när de rör sig (runnerPhase.ts).
test.use({ reducedMotion: 'reduce', storageState: { cookies: [], origins: [] }, trace: 'off', screenshot: 'off', video: 'off' });

/** Hur länge fullappens JS hålls: längre än provet, så laddaren i index.html är det som ritas under hela mätningen. */
const APP_SCRIPT_HOLD_MS = 6_000;
/** Ritade bildrutor med laddaren som provet kräver innan det säger något om dem. */
const MIN_FRAMES = 20;

interface PaintedFrame {
  visibleDots: number;
  dots: number;
  waiting: boolean;
}

test.describe('the runner dots with reduced motion', () => {
  test('are drawn from the first frame and the page never waits for their phase', async ({ page }) => {
    const frames: PaintedFrame[] = [];
    await page.exposeFunction('__rqReportDots', (frame: PaintedFrame) => frames.push(frame));
    await page.addInitScript((scope: string) => {
      const tick = () => {
        const dots = Array.from(document.querySelectorAll<HTMLElement>(`${scope} > div[aria-hidden="true"]`));
        if (dots.length > 0) {
          (window as unknown as { __rqReportDots: (frame: unknown) => void }).__rqReportDots({
            dots: dots.length,
            visibleDots: dots.filter((dot) => getComputedStyle(dot).visibility !== 'hidden').length,
            waiting: document.documentElement.classList.contains('rq-phase-pending'),
          });
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, LOADING_VIEW_STATUS);

    await delayAppScript(page, APP_SCRIPT_HOLD_MS);
    await page.goto('/legal', { waitUntil: 'commit' });
    await expect.poll(() => frames.length, { message: 'painted frames with the loader' }).toBeGreaterThanOrEqual(MIN_FRAMES);

    expect(frames.filter((frame) => frame.visibleDots !== frame.dots || frame.dots !== 3), 'frames where a dot was hidden or missing').toEqual([]);
    expect(frames.filter((frame) => frame.waiting), 'frames where the page was marked as waiting for the dots').toEqual([]);
  });
});
