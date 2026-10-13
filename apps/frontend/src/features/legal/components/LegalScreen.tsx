import { Link } from 'react-router-dom';
import { getDataPolicy, getTerms, type DataController, type LegalSection } from '@runquest/shared';
import { LEGAL_PRIVACY_ID, LEGAL_TERMS_ID, paths } from '@/paths';
import { LEGAL_CANONICAL_URL, LEGAL_PAGE_DESCRIPTION, LEGAL_PAGE_TITLE, legalSectionDomId, splitOnEmail } from '../legalModel';
import { usePageMetadata } from '../hooks/usePageMetadata';
import { useScrollToHash } from '../hooks/useScrollToHash';
import '../legal.css';

const PRIVACY_HEADING_ID = `legal-heading-${LEGAL_PRIVACY_ID}`;
const TERMS_HEADING_ID = `legal-heading-${LEGAL_TERMS_ID}`;

function ContactLink({ email }: { email: string }) {
  return <a href={`mailto:${email}`}>{email}</a>;
}

/** Ett stycke i klartext; kontaktadressen i texten blir en mailto-länk, resten renderas som det står. */
function Paragraph({ text, email }: { text: string; email: string }) {
  return (
    <p>
      {splitOnEmail(text, email).map((part, index) =>
        part.kind === 'email' ? <ContactLink key={index} email={email} /> : part.text,
      )}
    </p>
  );
}

function LegalSectionArticle({ section, controller }: { section: LegalSection; controller: DataController }) {
  const headingId = legalSectionDomId(section.id);
  return (
    <article className="rq-legal-article" aria-labelledby={headingId}>
      <h3 id={headingId} className="rq-title rq-legal-article__title">
        {section.title}
      </h3>
      {section.paragraphs.map((text, index) => (
        <Paragraph key={index} text={text} email={controller.email} />
      ))}
    </article>
  );
}

/**
 * /legal: integritetstext och villkor på en publik sida, ett dokument med ankarna #privacy och #terms. Texten, versionen och
 * personuppgiftsansvarig läses ur den delade källan (`@runquest/shared`); komponenten skriver ingen text själv. Inga anrop.
 */
export function LegalScreen() {
  const policy = getDataPolicy();
  const terms = getTerms();
  usePageMetadata({ title: LEGAL_PAGE_TITLE, description: LEGAL_PAGE_DESCRIPTION, canonical: LEGAL_CANONICAL_URL });
  useScrollToHash();

  return (
    <div className="rq-legal">
      <div className="rq-legal__inner">
        <header className="rq-legal-header">
          <Link to={paths.landing} className="rq-legal-back">
            Back to RunQuest
          </Link>
        </header>
        <main className="rq-legal-main">
          <h1 className="rq-display rq-legal-title">Privacy &amp; Terms</h1>

          <section id={LEGAL_PRIVACY_ID} aria-labelledby={PRIVACY_HEADING_ID} className="rq-legal-part">
            <h2 id={PRIVACY_HEADING_ID} className="rq-heading rq-legal-part__title">
              Privacy
            </h2>
            <p className="rq-legal-controller">
              Data controller: {policy.controller.name}, <ContactLink email={policy.controller.email} />
            </p>
            <p className="rq-meta rq-legal-version">Version {policy.version}</p>
            {policy.sections.map((section) => (
              <LegalSectionArticle key={section.id} section={section} controller={policy.controller} />
            ))}
          </section>

          <section id={LEGAL_TERMS_ID} aria-labelledby={TERMS_HEADING_ID} className="rq-legal-part">
            <h2 id={TERMS_HEADING_ID} className="rq-heading rq-legal-part__title">
              Terms
            </h2>
            {terms.sections.map((section) => (
              <LegalSectionArticle key={section.id} section={section} controller={terms.controller} />
            ))}
          </section>
        </main>
        <footer className="rq-legal-footer">
          <p>
            Questions? <ContactLink email={policy.controller.email} />
          </p>
        </footer>
      </div>
    </div>
  );
}
