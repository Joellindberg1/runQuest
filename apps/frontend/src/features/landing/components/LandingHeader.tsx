import { Link } from 'react-router-dom';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { FROM_LANDING_STATE, paths } from '@/paths';
import { track } from '@/shared/analytics/track';
import { RQLogo } from '@/shared/components/icons';
import { LANDING_NAV } from '../landingModel';

/**
 * Wordmark till vänster; till höger (desktop) ankarlänkarna och alltid Sign in som guldkontur. Sign in öppnar inloggningsdialogen:
 * adressen blir /login och pages/Index monterar dialogen, så Landing ligger kvar under utan att monteras om.
 * Wordmarken är ingen länk (en länk till sidan man redan är på är en onödig tabbstopp).
 */
export function LandingHeader() {
  const isDesktop = useIsDesktop() === true;

  return (
    <header className="rq-landing-header">
      <RQLogo className="rq-landing-logo" />
      <div className="rq-landing-header__actions">
        {isDesktop && (
          <nav className="rq-landing-nav" aria-label="Sections">
            {LANDING_NAV.map((item) => (
              <a key={item.id} href={`#${item.id}`}>{item.label}</a>
            ))}
          </nav>
        )}
        <Link to={paths.login} state={FROM_LANDING_STATE} className="rq-btn rq-btn--secondary rq-btn--sm" aria-haspopup="dialog" onClick={() => track('login-click')}>Sign in</Link>
      </div>
    </header>
  );
}
