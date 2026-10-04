import { Link } from 'react-router-dom';

interface EmptyStateProps {
  title: string;
  text?: string;
  actionLabel: string;
  actionTo: string;
  /** Sidor som redan har en h1 (Titles) skickar `h2`, så rubriknivåerna förblir ordnade. */
  headingLevel?: 'h1' | 'h2';
}

/** Tomt läge enligt regel 9: streckad kant, Bebas-rubrik, en sekundärknapp. */
export function EmptyState({ title, text, actionLabel, actionTo, headingLevel: Heading = 'h1' }: EmptyStateProps) {
  return (
    <section className="rq-empty rq-rise">
      <Heading className="rq-empty__title">{title}</Heading>
      {text && <p className="rq-empty__text">{text}</p>}
      <Link to={actionTo} className="rq-btn rq-btn--secondary">
        {actionLabel}
      </Link>
    </section>
  );
}
