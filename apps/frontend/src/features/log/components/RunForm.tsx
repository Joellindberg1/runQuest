import { useRef, type FormEvent } from 'react';
import { MIN_RUN_DATE, MIN_RUN_DISTANCE_KM } from '@/constants/appConstants';
import type { LogFormState } from '../hooks/useLogForm';
import { formatKm, formatLongDate } from '../logFormat';
import { QUICK_KM, parseKm, type Surface } from '../logModel';

const SURFACES: ReadonlyArray<{ key: Surface; label: string }> = [
  { key: 'outdoor', label: 'Outdoor' },
  { key: 'treadmill', label: 'Treadmill' },
];

interface RunFormProps {
  state: LogFormState;
  isDesktop: boolean;
  /** Stockholm-dagen: fältets övre gräns. */
  today: string;
}

/**
 * Formuläret: datum, distans (snabbval), utomhus/löpband och EN guldknapp. Valideringen är backendens regler med vänliga
 * fel; bekräftelsen och serverns fel ligger i permanenta live-regioner (texten monteras in i en behållare som redan finns).
 * Hjälptexterna under fälten hör till desktopprototypen — på mobil läses de bara upp, och synas när något är fel.
 */
export function RunForm({ state, isDesktop, today }: RunFormProps) {
  const dateRef = useRef<HTMLInputElement>(null);
  const distanceRef = useRef<HTMLInputElement>(null);
  const { form, errors } = state;
  const km = parseKm(form.distance);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const rejected = await state.submit();
    if (rejected?.date) dateRef.current?.focus();
    else if (rejected?.distance) distanceRef.current?.focus();
  };

  const noteClass = (error: string | undefined) => (isDesktop || error ? 'rq-log-note' : 'sr-only');

  return (
    <form className="rq-card rq-card--hero rq-log-form" noValidate onSubmit={onSubmit} aria-label="Log a run">
      <div className="rq-log-form__fields">
        <div className="rq-log-field">
          <label htmlFor="log-date" className="rq-log-label">
            Date
          </label>
          <input
            ref={dateRef}
            id="log-date"
            type="date"
            className="rq-field"
            value={form.date}
            min={MIN_RUN_DATE}
            max={today}
            aria-invalid={errors.date ? true : undefined}
            aria-describedby="log-date-note"
            onChange={(event) => state.setDate(event.target.value)}
          />
          <p id="log-date-note" className={noteClass(errors.date)} data-tone={errors.date ? 'error' : undefined}>
            {errors.date ?? `From ${formatLongDate(MIN_RUN_DATE)} onwards`}
          </p>
        </div>

        <div className="rq-log-field">
          <label htmlFor="log-distance" className="rq-log-label">
            Distance (km)
          </label>
          <input
            ref={distanceRef}
            id="log-distance"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.0"
            className="rq-field rq-field--mono"
            value={form.distance}
            aria-invalid={errors.distance ? true : undefined}
            aria-describedby="log-distance-note"
            onChange={(event) => state.setDistance(event.target.value)}
          />
          <p id="log-distance-note" className={noteClass(errors.distance)} data-tone={errors.distance ? 'error' : undefined}>
            {errors.distance ?? `Minimum ${formatKm(MIN_RUN_DISTANCE_KM)} km to count`}
          </p>
        </div>
      </div>

      <div role="group" aria-label="Quick distances" className="rq-log-quick">
        {QUICK_KM.map((value) => (
          <button
            key={value}
            type="button"
            className="rq-filter"
            aria-pressed={km === Number(value)}
            onClick={() => state.setDistance(value)}
          >
            {value} km
          </button>
        ))}
      </div>

      <div role="group" aria-label="Surface" className="rq-log-surface">
        {SURFACES.map(({ key, label }) => (
          <button key={key} type="button" className="rq-log-surface__option" data-surface={key} aria-pressed={form.surface === key} onClick={() => state.setSurface(key)}>
            {label}
          </button>
        ))}
      </div>

      <button type="submit" className={`rq-btn rq-btn--primary ${isDesktop ? 'rq-btn--lg ' : ''}rq-btn--block`} disabled={state.pending}>
        {state.pending ? 'Logging…' : 'Log run'}
      </button>

      {/* Live regions måste finnas innan texten kommer för att annonseras: behållarna är permanenta, bara texten monteras. */}
      <div role="status" className="rq-log-notice-slot">
        {state.notice && (
          <p className="rq-log-notice" data-tone="up">
            {state.notice}
          </p>
        )}
      </div>
      <div role="alert" className="rq-log-notice-slot">
        {state.serverError && (
          <p className="rq-log-notice" data-tone="error">
            {state.serverError}
          </p>
        )}
      </div>
    </form>
  );
}
