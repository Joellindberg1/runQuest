import './staging-banner.css';

/**
 * Markering för stagingmiljön: smal, alltid överst och lika på landningen, login och inloggade sidor. App.tsx monterar den bara när bygget har
 * VITE_APP_ENV=staging, så prodbygget varken laddar eller ritar den.
 */
export function StagingBanner() {
  return (
    <aside className="rq-staging-banner" aria-label="Staging environment">
      <strong className="rq-staging-banner__tag">STAGING</strong>
      <span className="rq-staging-banner__note">Test environment</span>
    </aside>
  );
}
