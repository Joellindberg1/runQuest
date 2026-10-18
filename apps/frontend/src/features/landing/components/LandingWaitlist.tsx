import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { WAITLIST_CONSENT_LABEL, WAITLIST_CONSENT_LINK_TEXT, WAITLIST_EMAIL_MAX_LENGTH } from '@runquest/shared';
import { legalPrivacyPath } from '@/paths';
import { track } from '@/shared/analytics/track';
import { TextField } from '@/shared/components/form/TextField';
import { useJoinWaitlist } from '../hooks/useJoinWaitlist';
import '../landingWaitlist.css';

export const WAITLIST_ID = 'waitlist';

const TITLE_ID = 'landing-waitlist-title';
const EMAIL_ID = 'waitlist-email';
const CONSENT_ID = 'waitlist-consent';
const EMAIL_ERROR_ID = 'waitlist-email-error';
const CONSENT_ERROR_ID = 'waitlist-consent-error';
const FORM_ERROR_ID = 'waitlist-form-error';

// Samma form som servern godtar (något@domän.tld utan blanksteg); servern gör den slutliga prövningen.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

const MESSAGES = {
  emailMissing: 'Enter your email address.',
  emailInvalid: 'Enter a valid email address.',
  consentMissing: 'Tick the box to agree before you join.',
  rateLimited: 'Too many tries. Try again in a few minutes.',
  failed: 'Something went wrong. Try again.',
} as const;

/**
 * Väntelistans kort på landingen: e-post, samtyckesbock och EN guldknapp. Samma tack för ny och redan anmäld adress (servern svarar 200 för
 * båda) och inget bekräftelsemejl (nivå 1). Felen står vid fältet eller bocken (aria-invalid + aria-describedby + role=alert) och det ifyllda
 * ligger kvar. Honeypot-fältet `website` ligger utanför skärmen och är dolt för tangentbord och skärmläsare. Anropet ligger i useJoinWaitlist.
 */
export function LandingWaitlist() {
  const { join, isPending } = useJoinWaitlist();
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [emailError, setEmailError] = useState('');
  const [consentError, setConsentError] = useState('');
  const [formError, setFormError] = useState('');
  const [done, setDone] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (isPending) return;
    const trimmed = email.trim();
    const nextEmailError = !trimmed ? MESSAGES.emailMissing : trimmed.length > WAITLIST_EMAIL_MAX_LENGTH || !EMAIL_SHAPE.test(trimmed) ? MESSAGES.emailInvalid : '';
    const nextConsentError = consent ? '' : MESSAGES.consentMissing;
    setEmailError(nextEmailError);
    setConsentError(nextConsentError);
    setFormError('');
    if (nextEmailError) { emailRef.current?.focus(); return; }
    if (nextConsentError) { consentRef.current?.focus(); return; }

    const outcome = await join({ email: trimmed, website });
    if (outcome === 'joined') { track('waitlist-joined'); setDone(true); }
    else if (outcome === 'invalid') { setEmailError(MESSAGES.emailInvalid); emailRef.current?.focus(); }
    else if (outcome === 'rate-limited') setFormError(MESSAGES.rateLimited);
    else if (outcome === 'failed') setFormError(MESSAGES.failed);
  };

  return (
    <section id={WAITLIST_ID} className="rq-landing-waitlist" aria-labelledby={TITLE_ID}>
      <h2 id={TITLE_ID} className="rq-landing-waitlist__title">Join the waitlist</h2>
      {done ? (
        <div ref={doneRef} role="status" tabIndex={-1} className="rq-landing-waitlist__done">
          <p className="rq-landing-waitlist__done-title">You're on the list.</p>
          <p className="rq-body rq-landing-waitlist__done-text">No confirmation email is sent. You'll get an invite when a pack can start.</p>
        </div>
      ) : (
        <>
          <p className="rq-lead rq-landing-waitlist__lead">RunQuest is invite-only while in beta. Leave your email and you'll get an invite when a pack can start.</p>
          <form className="rq-landing-waitlist__form" aria-labelledby={TITLE_ID} aria-busy={isPending} noValidate onSubmit={(event) => void submit(event)}>
            <div className="rq-landing-waitlist__row">
              <TextField
                ref={emailRef}
                id={EMAIL_ID}
                label="Email"
                type="email"
                autoComplete="email"
                required
                maxLength={WAITLIST_EMAIL_MAX_LENGTH}
                value={email}
                onChange={(event) => { setEmail(event.target.value); setEmailError(''); }}
                invalid={!!emailError}
                aria-describedby={emailError ? EMAIL_ERROR_ID : undefined}
              />
              <button
                type="submit"
                className="rq-btn rq-btn--primary rq-btn--lg rq-landing-waitlist__submit"
                aria-busy={isPending}
                aria-disabled={isPending}
                aria-describedby={formError ? FORM_ERROR_ID : undefined}
              >
                {isPending ? 'Joining…' : 'Join the waitlist'}
              </button>
            </div>
            {emailError && <p id={EMAIL_ERROR_ID} role="alert" className="rq-landing-waitlist__error">{emailError}</p>}
            <div className="rq-landing-waitlist__consent">
              <label htmlFor={CONSENT_ID} className="rq-landing-waitlist__consent-label">
                <input
                  ref={consentRef}
                  id={CONSENT_ID}
                  type="checkbox"
                  className="rq-landing-waitlist__check"
                  checked={consent}
                  onChange={(event) => { setConsent(event.target.checked); setConsentError(''); }}
                  aria-invalid={consentError ? true : undefined}
                  aria-describedby={consentError ? CONSENT_ERROR_ID : undefined}
                />
                {WAITLIST_CONSENT_LABEL}
              </label>
              <Link to={legalPrivacyPath}>{WAITLIST_CONSENT_LINK_TEXT}</Link>
            </div>
            {consentError && <p id={CONSENT_ERROR_ID} role="alert" className="rq-landing-waitlist__error">{consentError}</p>}
            {formError && <p id={FORM_ERROR_ID} role="alert" className="rq-landing-waitlist__error">{formError}</p>}
            <div className="rq-landing-waitlist__trap" aria-hidden="true">
              <label>
                Website
                <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={(event) => setWebsite(event.target.value)} />
              </label>
            </div>
          </form>
          <ul className="rq-landing-waitlist__facts">
            <li>No app to install</li>
          </ul>
        </>
      )}
    </section>
  );
}
