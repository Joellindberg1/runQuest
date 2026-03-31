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

export function OnboardingTour({ steps, onDone, delayMs = 800 }: OnboardingTourProps) {
  const doneRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => {
      const driverObj = driver({
        animate: true,
        showProgress: true,
        allowClose: true,
        overlayOpacity: 0.75,
        stagePadding: 8,
        stageRadius: 8,
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
        steps: steps.map(s => ({
          ...(s.element ? { element: s.element } : {}),
          popover: { title: s.title, description: s.description },
        })),
      });
      driverObj.drive();
    }, delayMs);

    return () => clearTimeout(t);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
