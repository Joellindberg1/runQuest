import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';

const LOADING_ROWS = 5;

/** Sidans plats i skalet. Sällan besökta sidor är lazy, så Suspense hör hemma här. */
export function ShellOutlet() {
  const location = useLocation();
  // Runner card som overlay ändrar pathname men bakgrundssidan ska stå kvar där den är.
  const background = (location.state as { background?: { pathname: string } } | null)?.background;
  const scrollKey = background?.pathname ?? location.pathname;

  useEffect(() => {
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
  }, [scrollKey]);

  return (
    <Suspense fallback={<SkeletonRows rows={LOADING_ROWS} label="Loading" />}>
      <Outlet />
    </Suspense>
  );
}
