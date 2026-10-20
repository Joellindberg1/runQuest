import { zoneDay } from '@runquest/shared';
import { useCallback, useRef, useState } from 'react';
import { buildSubmission, confirmationText, initialForm, validateForm, type FieldErrors, type LogForm, type Surface } from '../logModel';
import { RUN_SAVED_RECALCULATING, RunWrittenError } from '@/features/runs/runEffects';
import { newIdempotencyKey } from '../idempotencyKey';
import { useCreateRun } from './useCreateRun';

export interface LogFormState {
  form: LogForm;
  /** Fel som visas just nu (tomt distansfält räknas först efter ett inlämningsförsök). */
  errors: FieldErrors;
  pending: boolean;
  /** Bekräftelsen efter en lyckad runda (serverns siffror). */
  notice: string | null;
  /** Serverns fel (t.ex. en regel klienten inte känner till) — formuläret står kvar orört. */
  serverError: string | null;
  setDate: (date: string) => void;
  setDistance: (distance: string) => void;
  setSurface: (surface: Surface) => void;
  /** Valideringsfelen om rundan inte skickades, annars null (skickad — lyckad eller ej, se notice/serverError). */
  submit: () => Promise<FieldErrors | null>;
}

/**
 * Formulärets tillstånd bor här (inte i vyn) så att det som skrivits överlever ett byte till Group history och tillbaka.
 * `now` är skärmens klocka: datumreglerna räknas mot Stockholm-dagen.
 *
 * Idempotens: varje inskick får en nyckel (uuid v4) som skickas som Idempotency-Key. Ett omförsök av SAMMA inskick (efter
 * nätfel/timeout där svaret aldrig kom fram) återanvänder nyckeln, så servern svarar med den redan skapade rundan i stället
 * för att skapa en dubblett. Nyckeln nollställs när rundan är sparad (lyckat svar eller `written`) och när något av
 * formulärvärdena ändras. Ett andra submit medan ett pågår gör ingenting.
 */
export function useLogForm(now: Date): LogFormState {
  const create = useCreateRun();
  const [form, setForm] = useState<LogForm>(() => initialForm(now));
  const [attempted, setAttempted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const today = zoneDay(now);
  const idempotencyKey = useRef<string | null>(null);
  const inFlight = useRef(false);

  const { reset } = create;
  const edit = useCallback(
    (patch: Partial<LogForm>) => {
      if ((Object.keys(patch) as Array<keyof LogForm>).some((field) => patch[field] !== form[field])) {
        idempotencyKey.current = null; // ändrade värden = ett annat inskick
      }
      setForm((previous) => ({ ...previous, ...patch }));
      setNotice(null);
      reset();
    },
    [form, reset],
  );

  const submit = async (): Promise<FieldErrors | null> => {
    if (inFlight.current) return null;
    setNotice(null);
    create.reset();
    const built = buildSubmission(form, today);
    if (!built.ok) {
      setAttempted(true);
      return built.errors;
    }
    inFlight.current = true;
    idempotencyKey.current ??= newIdempotencyKey();
    try {
      const run = await create.mutateAsync({ ...built.submission, idempotencyKey: idempotencyKey.current });
      idempotencyKey.current = null;
      setNotice(confirmationText(run));
      setForm(initialForm(now));
      setAttempted(false);
    } catch (error) {
      if (error instanceof RunWrittenError) {
        // Rundan finns redan (cachen är invaliderad): formuläret återställs så att en ny inskickning inte skapar en dubblett.
        idempotencyKey.current = null;
        create.reset();
        setNotice(RUN_SAVED_RECALCULATING);
        setForm(initialForm(now));
        setAttempted(false);
      }
      // Övriga fel ligger i create.error och visas av skärmen; nyckeln behålls så att ett omförsök blir idempotent.
    } finally {
      inFlight.current = false;
    }
    return null;
  };

  return {
    form,
    errors: validateForm(form, today, { allowEmptyDistance: !attempted }),
    pending: create.isPending,
    notice,
    serverError: create.error?.message ?? null,
    setDate: (date) => edit({ date }),
    setDistance: (distance) => edit({ distance }),
    setSurface: (surface) => edit({ surface }),
    submit,
  };
}
