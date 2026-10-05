import './form.css';

interface FormNoticesProps {
  /** Bekräftelse ("Password changed") — grön vänsterkant. */
  status?: string | null;
  /** Serverfel eller annat som gick fel — röd kant. */
  error?: string | null;
  /** Skiljer regionerna åt när flera formulär delar en sida ("Password status"). */
  name?: string;
  /** id på felstycket, så fält kan peka på det med aria-describedby. */
  errorId?: string;
}

/**
 * Bekräftelse och fel som permanenta live-regioner: behållarna finns i DOM:en innan texten monteras, annars annonseras
 * de inte pålitligt. Ersätter toast() — texten står kvar och kan läsas om. Tomma regioner tar ingen plats.
 */
export function FormNotices({ status, error, name, errorId }: FormNoticesProps) {
  return (
    <div className="rq-form-notices">
      <div role="status" aria-label={name ? `${name} status` : undefined}>
        {status && (
          <p className="rq-form-notice" data-tone="up">
            {status}
          </p>
        )}
      </div>
      <div role="alert" aria-label={name ? `${name} error` : undefined}>
        {error && (
          <p id={errorId} className="rq-form-notice" data-tone="error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
