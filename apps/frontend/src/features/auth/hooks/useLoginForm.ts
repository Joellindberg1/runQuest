import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AuthContextType } from '@/providers/authContext';

type Login = AuthContextType['login'];

/**
 * Inloggningsformulärets tillstånd. Egen laddning (ingen global loader): ett fel avmonterar aldrig formuläret, så fälten
 * står kvar och man kan försöka igen (App.login.test).
 *
 * Dialogen går att lämna under pågående inloggning (✕, Esc, scrim, Back). Då avbryts försöket: svaret kastas (`signal` till `login`,
 * som inte startar någon session) och inget tillstånd skrivs i en avmonterad komponent. Ett försök man lämnat får aldrig skicka en vidare
 * till /board mot sin vilja.
 */
export function useLoginForm(login: Login) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => { inFlight.current?.abort(); }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    const attempt = new AbortController();
    inFlight.current = attempt;
    const result = await login(username, password, { signal: attempt.signal });
    if (attempt.signal.aborted) return;
    setLoading(false);
    if (!result.success) setError(result.error || 'Login failed');
  };

  return { username, setUsername, password, setPassword, error, loading, submit };
}
