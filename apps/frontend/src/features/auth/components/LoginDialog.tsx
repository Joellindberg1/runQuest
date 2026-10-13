import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useAuth } from '@/providers/authContext';
import { FormNotices } from '@/shared/components/form/FormNotices';
import { TextField } from '@/shared/components/form/TextField';
import { useLoginForm } from '../hooks/useLoginForm';
import { useCloseLogin } from '../hooks/useCloseLogin';
import '../login.css';

const ERROR_ID = 'login-error';

/**
 * Inloggningen som en popup ovanpå Landing (RUN-145; ADR 006 beslut 1, addendum). Monteras av `pages/Index` när adressen är `/login`.
 * Radix Dialog ger role=dialog, aria-modal, fokusfälla, Escape och klick på scrimmen; ✕ är `Dialog.Close`. Fokus går till första fältet
 * (inte till ✕), och när dialogen stängs lämnas fokus tillbaka till det som hade det före (Landingens Sign in-länk).
 * Skalets delade lager (`.rq-scrim`/`.rq-modal`) ger mörkläggningen. EN guldknapp: Sign In. Landings egen guldknapp ligger kvar bakom scrimmen (mörkad, och
 * ointeragerbar och dold för hjälpmedel medan dialogen är öppen), så vyn har en aktiv primärhandling.
 * Felet landar i en permanent role=alert-region; fälten pekar på det (aria-describedby) och står kvar. Under pågående inloggning är fälten
 * readOnly och knappen aria-disabled (inte disabled) — fokus tappas aldrig. Dialogen går att lämna även då (✕, Esc, scrim, Back): försöket avbryts och svaret kastas (useLoginForm → AuthProvider.login), så en inloggning man lämnat aldrig skickar vidare till /board.
 */
export function LoginDialog() {
  const { login } = useAuth();
  const form = useLoginForm(login);
  const close = useCloseLogin();
  const usernameRef = useRef<HTMLInputElement>(null);
  // Elementet som hade fokus när dialogen öppnades (ingen Trigger: den öppnas av adressen). Läses vid första renderingen, före Radix flyttar fokus.
  const [returnFocusTo] = useState(() => document.activeElement);
  const describedBy = form.error ? ERROR_ID : undefined;

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="rq-scrim" />
        <Dialog.Content
          className="rq-modal rq-login-dialog"
          aria-modal="true"
          onOpenAutoFocus={(event) => { event.preventDefault(); usernameRef.current?.focus(); }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocusTo instanceof HTMLElement && returnFocusTo !== document.body && returnFocusTo.isConnected) returnFocusTo.focus({ preventScroll: true });
          }}
        >
          <Dialog.Close className="rq-modal__close" aria-label="Close">✕</Dialog.Close>
          <header className="rq-login-dialog__head">
            <Dialog.Title className="rq-heading rq-login-dialog__title">Sign in</Dialog.Title>
            <Dialog.Description className="rq-login-dialog__sub">Continue your journey</Dialog.Description>
          </header>
          <form className="rq-form rq-login-dialog__form" onSubmit={(event) => void form.submit(event)} aria-label="Sign in" aria-busy={form.loading}>
            <TextField
              ref={usernameRef}
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
