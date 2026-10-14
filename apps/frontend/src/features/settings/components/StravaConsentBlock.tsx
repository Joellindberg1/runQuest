import { Link } from 'react-router-dom';
import { STRAVA_CONSENT_KEY_POINTS, getDataPolicySection } from '@runquest/shared';
import { legalPrivacyPath } from '@/paths';
import { RQIcon } from '@/shared/components/icons';

/** Samma rubrik i båda lägena; regionens namn. Själva texten kommer alltid från den delade samtyckeskällan, aldrig från en kopia här. */
const CONSENT_TITLE = 'What happens to your Strava data';
const AGREE_LABEL = "I've read this and agree that RunQuest imports my Strava runs as described";
const PRIVACY_LINK_TEXT = 'Read the full privacy policy';
const ICON_SIZE = 15;

const TITLE_ID = 'settings-strava-consent-title';
const AGREE_ID = 'settings-strava-consent-agree';

const STRAVA_SECTION = getDataPolicySection('strava');

function Chevron() {
  return (
    <span className="rq-consent__chev" aria-hidden="true">
      <RQIcon name="chevron" size={ICON_SIZE} />
    </span>
  );
}

function Paragraphs({ items }: { items: readonly string[] }) {
  return items.map((paragraph) => (
    <p key={paragraph} className="rq-consent__p">
      {paragraph}
    </p>
  ));
}

interface StravaConsentBlockProps {
  agreed: boolean;
  onAgreedChange: (agreed: boolean) => void;
}

/**
 * Samtycket före "Connect Strava" (ägarbeslut 2026-10-14): de fyra punkterna står synliga som en lista, ordagrant ur den delade källan
 * (STRAVA_CONSENT_KEY_POINTS), och hela Strava-avsnittet (getDataPolicySection('strava'), rena stycken utan HTML) ligger hopfällt bakom
 * "Read the full text" — sidan scrollar som vanligt, ingen scrollruta. Rutan står direkt efter punkterna; knappen låses upp av den (StravaCard).
 */
export function StravaConsentBlock({ agreed, onAgreedChange }: StravaConsentBlockProps) {
  if (!STRAVA_SECTION) return null;

  return (
    <section className="rq-consent" aria-labelledby={TITLE_ID}>
      <h3 id={TITLE_ID} className="rq-consent__title">{CONSENT_TITLE}</h3>
      <ul className="rq-consent__points" aria-label="The four things to know before you connect">
        {STRAVA_CONSENT_KEY_POINTS.map((point) => (
          <li key={point.id} className="rq-consent__point">
            <span className="rq-dot rq-consent__dot" aria-hidden="true" />
            {point.sentences.join(' ')}
          </li>
        ))}
      </ul>
      <details className="rq-consent__more">
        <summary className="rq-consent__summary">
          Read the full text
          <Chevron />
        </summary>
        <Paragraphs items={STRAVA_SECTION.paragraphs} />
      </details>
      <div className="rq-consent__agree">
        <label htmlFor={AGREE_ID} className="rq-consent__label">
          <input
            id={AGREE_ID}
            type="checkbox"
            className="rq-consent__check"
            checked={agreed}
            onChange={(event) => onAgreedChange(event.target.checked)}
          />
          {AGREE_LABEL}
        </label>
        <Link className="rq-consent__link" to={legalPrivacyPath}>{PRIVACY_LINK_TEXT}</Link>
      </div>
    </section>
  );
}

/**
 * Samma text som information för den som redan är ansluten (ADR 010 beslut 12, D4: ingen ny begäran om godkännande, ingen ruta).
 * Hopfälld från början och placerad ovanför kortets knappar, så fler knappar i kortet aldrig flyttar den.
 */
export function StravaConsentInfo() {
  if (!STRAVA_SECTION) return null;
  return (
    <section className="rq-consent rq-consent--info" aria-labelledby={TITLE_ID}>
      <details className="rq-consent__more">
        <summary id={TITLE_ID} className="rq-consent__summary">
          {CONSENT_TITLE}
          <Chevron />
        </summary>
        <Paragraphs items={STRAVA_SECTION.paragraphs} />
        <Link className="rq-consent__link" to={legalPrivacyPath}>{PRIVACY_LINK_TEXT}</Link>
      </details>
    </section>
  );
}
