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

const RESIZE_SETTLE_MS = 150;

export function OnboardingTour({ steps, onDone, delayMs = 800 }: OnboardingTourProps) {
  const doneRef = useRef(false);

  useEffect(() => {
    let running: ReturnType<typeof driver> | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;

    // Ett ankare kan bytas ut medan steget visas (/news: kortet i kolumnen ↔ kugghjulsknappen vid 1024 px). driver.js slår upp selektorn bara
    // när ett steg börjar, så markeringen skulle ligga kvar på det borttagna elementet. Kontrollen väntar ut att React hunnit rendera om
    // (brytpunkten läses via matchMedia, som kan svara efter resize-händelsen) och visar sedan om samma steg mot det nya elementet.
    const followAnchor = () => {
      const current = running?.getActiveElement();
      if (running && current && !current.isConnected) running.drive(running.getActiveIndex());
    };
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(followAnchor, RESIZE_SETTLE_MS);
    };

    const t = setTimeout(() => {

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
          stageRadius: 0,
          popoverClass: 'rq-tour-popover',
          nextBtnText: 'Next →',
          prevBtnText: '← Back',
          doneBtnText: 'Done',
          onDestroyStarted: () => {
            if (!doneRef.current) {
              doneRef.current = true;
              onDone();
            }
            driverObj.destroy();
          },
          steps: resolvedSteps.map(s => ({
            ...(s.element ? { element: s.element } : {}),
            popover: { title: s.title, description: s.description },
          })),
        });
        running = driverObj;
        window.addEventListener('resize', onResize);
        driverObj.drive();
      };
      startTour();
    }, delayMs);

    return () => {
      clearTimeout(t);
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      // Avmonteras mitt i turen (webbläsarens Back, route-byte) ska varken dialogen eller `driver-active` ligga kvar. destroy() anropar inte
      // onDestroyStarted, så turen markeras inte sedd av att man lämnar sidan. Efter Done/Esc är driver redan nedplockad.
      if (running?.isActive()) running.destroy();
      running = null;
    };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
