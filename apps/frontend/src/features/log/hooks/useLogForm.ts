import { useCallback, useState } from 'react';
import { buildSubmission, confirmationText, initialForm, todayOf, validateForm, type FieldErrors, type LogForm, type Surface } from '../logModel';
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
 */
export function useLogForm(now: Date): LogFormState {
  const create = useCreateRun();
  const [form, setForm] = useState<LogForm>(() => initialForm(new Date()));
  const [attempted, setAttempted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const today = todayOf(now);

  const { reset } = create;
  const edit = useCallback(
    (patch: Partial<LogForm>) => {
      setForm((previous) => ({ ...previous, ...patch }));
      setNotice(null);
      reset();
    },
    [reset],
  );

  const submit = async (): Promise<FieldErrors | null> => {
    setNotice(null);
    create.reset();
    const built = buildSubmission(form, today);
    if (!built.ok) {
      setAttempted(true);
      return built.errors;
    }
    try {
      const run = await create.mutateAsync(built.submission);
      setNotice(confirmationText(run));
      setForm(initialForm(new Date()));
      setAttempted(false);
    } catch {
      // Felet ligger i create.error och visas av skärmen.
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
