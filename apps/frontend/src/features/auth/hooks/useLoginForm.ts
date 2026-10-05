import { useState, type FormEvent } from 'react';

type Login = (nameOrEmail: string, password: string) => Promise<{ success: boolean; error?: string }>;

/**
 * Inloggningsformulärets tillstånd. Egen laddning (ingen global loader): ett fel avmonterar aldrig formuläret, så fälten
 * står kvar och man kan försöka igen (App.login.test).
 */
export function useLoginForm(login: Login) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    const result = await login(username, password);
    setLoading(false);
    if (!result.success) setError(result.error || 'Login failed');
  };

  return { username, setUsername, password, setPassword, error, loading, submit };
}
