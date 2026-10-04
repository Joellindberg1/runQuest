import './error-state.css';

interface ErrorStateProps {
  title?: string;
  /** En mening om vad som hände och att datan är säker. */
  message?: string;
  onRetry: () => void;
  /** Medan omförsöket pågår. */
  retrying?: boolean;
}

/** Felläge enligt regel 9: rött kantkort, en mening om att datan är säker och "Retry". */
export function ErrorState({
  title = "Couldn't load this",
  message = 'Your data is safe — we just could not reach the server. Try again in a moment.',
  onRetry,
  retrying = false,
}: ErrorStateProps) {
  return (
    <section role="alert" className="rq-card rq-card--edge rq-error">
      <h2 className="rq-error__title">{title}</h2>
      <p className="rq-error__text">{message}</p>
      <button type="button" className="rq-btn rq-btn--secondary rq-btn--compact" onClick={onRetry} disabled={retrying}>
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    </section>
  );
}
