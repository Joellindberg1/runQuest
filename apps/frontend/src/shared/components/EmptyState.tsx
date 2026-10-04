import { Link } from 'react-router-dom';

interface EmptyStateProps {
  title: string;
  text?: string;
  actionLabel: string;
  actionTo: string;
}

/** Tomt läge enligt regel 9: streckad kant, Bebas-rubrik, en sekundärknapp. */
export function EmptyState({ title, text, actionLabel, actionTo }: EmptyStateProps) {
  return (
    <section className="rq-empty rq-rise">
      <h1 className="rq-empty__title">{title}</h1>
      {text && <p className="rq-empty__text">{text}</p>}
      <Link to={actionTo} className="rq-btn rq-btn--secondary">
        {actionLabel}
      </Link>
    </section>
  );
}
