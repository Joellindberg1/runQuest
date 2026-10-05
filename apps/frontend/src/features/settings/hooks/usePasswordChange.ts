import { useState } from 'react';
import { backendApi } from '@/shared/services/backendApi';
import { EMPTY_PASSWORD_FORM, validatePasswordChange, type PasswordErrors, type PasswordForm } from '../settingsModel';

/**
 * Lösenordsbytets tillstånd. Valideringen körs vid inlämning (inte medan man skriver) och görs inget anrop om något är
 * fel; `submit` svarar med felen så att formuläret kan flytta fokus till första felfältet. Att skriva efter en
 * bekräftelse eller ett fel tar bort det gamla meddelandet.
 */
export function usePasswordChange() {
  const [form, setForm] = useState<PasswordForm>(EMPTY_PASSWORD_FORM);
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const setField = (field: keyof PasswordForm, value: string) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => (previous[field] ? { ...previous, [field]: undefined } : previous));
    setStatus(null);
    setServerError(null);
  };

  /** Svarar med fältfelen om inlämningen avvisades, annars undefined. */
  const submit = async (): Promise<PasswordErrors | undefined> => {
    setStatus(null);
    setServerError(null);
    const found = validatePasswordChange(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return found;

    setPending(true);
    try {
      const result = await backendApi.changePassword(form.current, form.next);
      if (result.success) {
        setForm(EMPTY_PASSWORD_FORM);
        setStatus('Password changed.');
      } else {
        setServerError(result.error || 'Could not change the password');
      }
    } catch {
      setServerError('Could not change the password');
    } finally {
      setPending(false);
    }
    return undefined;
  };

  return { form, errors, pending, status, serverError, setField, submit };
}
