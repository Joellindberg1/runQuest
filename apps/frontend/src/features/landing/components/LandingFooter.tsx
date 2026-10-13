import { useTheme } from 'next-themes';
import { Link } from 'react-router-dom';
import { legalPrivacyPath, legalTermsPath } from '@/paths';
import { version } from '../../../../package.json';

const STRAVA_LOGO_ON_DARK = '/brand/api_logo_cptblWith_strava_horiz_white.svg';
const STRAVA_LOGO_ON_LIGHT = '/brand/api_logo_cptblWith_strava_horiz_black.svg';
/** Stravas logga har proportionen 437:37; höjden sätts i CSS till textens teckenhöjd (1em) och bredden följer bilden. */
const STRAVA_LOGO_WIDTH = 437;
const STRAVA_LOGO_HEIGHT = 37;

/**
 * Footern: varumärkesraden, länkarna till /legal, Stravas attribution och den riktiga versionen (package.json, samma värde som
 * scripts/check-versions.mjs vaktar). Stravas "Compatible with Strava" visas oförändrad: ingen filter, ingen hover, inte större än
 * texten, skild från RunQuests wordmark. Svart variant på ljus botten, vit annars.
 */
export function LandingFooter() {
  const { resolvedTheme } = useTheme();
  const logo = resolvedTheme === 'light' ? STRAVA_LOGO_ON_LIGHT : STRAVA_LOGO_ON_DARK;

  return (
    <footer className="rq-landing-footer">
      <p className="rq-landing-footer__brand"><span className="rq-landing-footer__name">RunQuest · </span>Run · Rank · Reign</p>
      <div className="rq-landing-footer__aside">
        <nav className="rq-landing-footer__links" aria-label="Legal">
          <Link to={legalPrivacyPath}>Privacy</Link>
          <Link to={legalTermsPath}>Legal</Link>
        </nav>
        <img className="rq-landing-footer__strava" src={logo} width={STRAVA_LOGO_WIDTH} height={STRAVA_LOGO_HEIGHT} alt="Compatible with Strava" />
        <span className="rq-landing-footer__version">v{version}</span>
      </div>
    </footer>
  );
}
