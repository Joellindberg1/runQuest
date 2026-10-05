import { useRef, type FormEvent } from 'react';
import { FormNotices } from '@/shared/components/form/FormNotices';
import { TextField } from '@/shared/components/form/TextField';
import { usePasswordChange } from '../hooks/usePasswordChange';
import { PASSWORD_FIELD_ORDER, type PasswordForm } from '../settingsModel';

const FIELDS: ReadonlyArray<{ key: keyof PasswordForm; id: string; label: string; autoComplete: string; hint?: string }> = [
  { key: 'current', id: 'settings-current-password', label: 'Current password', autoComplete: 'current-password' },
  { key: 'next', id: 'settings-new-password', label: 'New password', autoComplete: 'new-password', hint: 'At least 6 characters' },
  { key: 'confirm', id: 'settings-confirm-password', label: 'Repeat new password', autoComplete: 'new-password' },
];

/** Byt lösenord: tre fält, felen bredvid fältet (aria-invalid + aria-describedby), EN guldknapp — Settings primära handling. */
export function PasswordCard() {
  const password = usePasswordChange();
  const refs = useRef<Partial<Record<keyof PasswordForm, HTMLInputElement | null>>>({});

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const rejected = await password.submit();
    if (!rejected) return;
    const first = PASSWORD_FIELD_ORDER.find((key) => rejected[key]);
    if (first) refs.current[first]?.focus();
  };

  return (
    <form className="rq-card rq-card--edge rq-form rq-settings-card" noValidate onSubmit={(event) => void onSubmit(event)} aria-labelledby="settings-password-title">
      <h2 id="settings-password-title" className="rq-heading rq-settings-card__title">Password</h2>
      <div className="rq-settings-pw">
        {FIELDS.map(({ key, id, label, autoComplete, hint }) => (
          <TextField
            key={key}
            ref={(element) => { refs.current[key] = element; }}
            id={id}
            label={label}
            type="password"
            autoComplete={autoComplete}
            placeholder="••••••••"
            value={password.form[key]}
            hint={hint}
            error={password.errors[key]}
            onChange={(event) => password.setField(key, event.target.value)}
          />
        ))}
      </div>
      <div className="rq-settings-actions">
        <button type="submit" className="rq-btn rq-btn--primary" disabled={password.pending}>
          {password.pending ? 'Changing…' : 'Change password'}
        </button>
      </div>
      <FormNotices name="Password" status={password.status} error={password.serverError} />
    </form>
  );
}
