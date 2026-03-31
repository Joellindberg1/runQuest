// 🎓 OnboardingTour — driver.js highlight tour wrapper
import { useEffect, useRef } from 'react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

export interface TourStep {
  element?: string; // CSS selector — omit for centered popover
  title: string;
  description: string;
}

interface OnboardingTourProps {
  steps: TourStep[];
  onDone: () => void;  // called on complete OR skip
  delayMs?: number;
  beforeStart?: () => void; // called before tour starts (e.g. open mobile sidebar)
  afterEnd?: () => void;    // called after tour ends or is dismissed
}

/**
 * Returns true if the element exists, has size, and isn't translated off-screen
 * (e.g. sidebar at translateX(-100%) on mobile). Intentionally does NOT reject
 * elements below the viewport fold — driver.js will scrollIntoView those.
 */
function isVisible(selector: string): boolean {
  const el = document.querySelector(selector);
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  // Reject elements clipped entirely off the left/right (e.g. mobile sidebar)
  if (rect.right <= 0 || rect.left >= window.innerWidth) return false;
  // Reject elements clipped entirely above the viewport (shouldn't happen in practice)
  if (rect.bottom <= 0) return false;
  // Elements below the fold are fine — driver.js scrollIntoView handles them
  return true;
}

export function OnboardingTour({ steps, onDone, delayMs = 800, beforeStart, afterEnd }: OnboardingTourProps) {
  const doneRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => {
      beforeStart?.();

      const startTour = () => {
        // Degrade steps whose target element isn't currently visible to floating popovers.
        // Handles: sidebar off-screen on mobile, display:none responsive elements, etc.
        const resolvedSteps = steps.map(s =>
          (!s.element || isVisible(s.element)) ? s : { ...s, element: undefined }
        );

        const driverObj = driver({
          animate: true,
          smoothScroll: true,
          showProgress: true,
          allowClose: true,
          overlayOpacity: 0.88,
          stagePadding: 8,
          stageRadius: 8,
          popoverClass: 'rq-tour-popover',
          nextBtnText: 'Next →',
          prevBtnText: '← Back',
          doneBtnText: 'Done',
          onDestroyStarted: () => {
            if (!doneRef.current) {
              doneRef.current = true;
              afterEnd?.();
              onDone();
            }
            driverObj.destroy();
          },
          steps: resolvedSteps.map(s => ({
            ...(s.element ? { element: s.element } : {}),
            popover: { title: s.title, description: s.description },
          })),
        });
        driverObj.drive();
      };

      if (beforeStart) {
        // Allow 350ms for any triggered animations (e.g. sidebar slide-in: 300ms) to settle
        setTimeout(startTour, 350);
      } else {
        startTour();
      }
    }, delayMs);

    return () => clearTimeout(t);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
