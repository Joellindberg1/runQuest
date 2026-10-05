import { useAuth } from '@/providers/authContext';
import { RQLogo } from '@/shared/components/icons';
import { FormNotices } from '@/shared/components/form/FormNotices';
import { TextField } from '@/shared/components/form/TextField';
import { useLoginForm } from '../hooks/useLoginForm';
import '../login.css';

const ERROR_ID = 'login-error';

/**
 * /login. Ingen prototyp finns — ritad i Landingens språk (glöd, logotyp, hjältekort) med Components-filens fält.
 * EN guldknapp. Felet landar i en permanent role=alert-region (som övriga formulär); fälten pekar på det (aria-describedby) och står kvar.
 * Under pågående inloggning är fälten readOnly och knappen aria-disabled (inte disabled) — fokus tappas aldrig.
 */
export function LoginScreen() {
  const { login } = useAuth();
  const form = useLoginForm(login);
  const describedBy = form.error ? ERROR_ID : undefined;

  return (
    <div className="rq-login">
      <div className="rq-login__glow" aria-hidden="true" />
      <main className="rq-login__inner">
        <RQLogo className="rq-login-logo" />
        <header className="rq-login__head">
          <h1 className="rq-display rq-login__title">Sign in</h1>
          <p className="rq-login__sub">Continue your journey</p>
        </header>

        <form className="rq-card rq-card--hero rq-form" onSubmit={(event) => void form.submit(event)} aria-label="Sign in" aria-busy={form.loading}>
          <TextField
            id="username"
            label="Username"
            value={form.username}
            onChange={(event) => form.setUsername(event.target.value)}
            placeholder="Enter your username"
            autoComplete="username"
            required
            readOnly={form.loading}
            invalid={!!form.error}
            aria-describedby={describedBy}
          />
          <TextField
            id="password"
            label="Password"
            type="password"
            value={form.password}
            onChange={(event) => form.setPassword(event.target.value)}
            placeholder="Enter your password"
            autoComplete="current-password"
            required
            readOnly={form.loading}
            invalid={!!form.error}
            aria-describedby={describedBy}
          />
          <FormNotices name="Sign in" error={form.error} errorId={ERROR_ID} />
          <button type="submit" className="rq-btn rq-btn--primary rq-btn--lg rq-btn--block" aria-disabled={form.loading || undefined}>
            {form.loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </main>
    </div>
  );
}
