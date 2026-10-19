import { useLayoutEffect, useRef } from 'react';
import './staging-banner.css';

const RESERVED_HEIGHT = '--rq-staging-banner-h';

/**
 * Markering för stagingmiljön: en smal rad överst som scrollar bort med sidan, lika på landningen, login och inloggade sidor. App.tsx monterar den
 * bara när bygget har VITE_APP_ENV=staging, så prodbygget varken laddar eller ritar den.
 *
 * Raden tar plats i flödet, så sidans 100dvh-ytor räknar bort dess höjd via --rq-staging-banner-h (0 i prod). Höjden mäts, eftersom den växer med
 * safe-area-inset-top (PWA) och kan bryta över två rader på en smal skärm.
 */
export function StagingBanner() {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const banner = ref.current;
    if (!banner) return undefined;
    const root = document.documentElement;
    const reserve = () => root.style.setProperty(RESERVED_HEIGHT, `${banner.offsetHeight}px`);
    reserve();
    const observer = new ResizeObserver(reserve);
    observer.observe(banner);
    return () => {
      observer.disconnect();
      root.style.removeProperty(RESERVED_HEIGHT);
    };
  }, []);

  return (
    <aside ref={ref} className="rq-staging-banner" aria-label="Staging environment">
      <strong className="rq-staging-banner__tag">STAGING</strong>
      <span className="rq-staging-banner__note">Test environment</span>
    </aside>
  );
}
