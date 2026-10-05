import { forwardRef, type InputHTMLAttributes } from 'react';
import './form.css';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className' | 'aria-invalid'> {
  id: string;
  label: string;
  /** Hjälptext under fältet. Ersätts av `error` när något är fel. */
  hint?: string;
  /** Vänligt felmeddelande. Sätter aria-invalid och kopplas till fältet via aria-describedby. */
  error?: string;
  /** Ogiltigt utan egen anteckning: felet visas på annat håll (skicka dess id i `aria-describedby`). */
  invalid?: boolean;
  /** Share Tech Mono i fältet: siffror, e-post, datum. */
  mono?: boolean;
  /** Etikett på skärmläsare men inte i bild (raden har redan en synlig rubrik). */
  hideLabel?: boolean;
}

/**
 * Formulärfältet ur Components ("Forms"): versal etikett, fält på inset-botten med guld ENDAST vid fokus, och
 * anteckningen under (hjälp eller fel). Etiketten är alltid en riktig <label> och anteckningen hänger ihop med fältet.
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { id, label, hint, error, invalid = false, mono = false, hideLabel = false, 'aria-describedby': describedBy, ...input },
  ref,
) {
  const note = error ?? hint;
  const noteId = `${id}-note`;
  const description = [describedBy, note ? noteId : undefined].filter(Boolean).join(' ') || undefined;
  return (
    <div className="rq-form-field">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'rq-form-label'}>
        {label}
      </label>
      <input
        {...input}
        ref={ref}
        id={id}
        className={mono ? 'rq-field rq-field--mono' : 'rq-field'}
        aria-invalid={error || invalid ? true : undefined}
        aria-describedby={description}
      />
      {note && (
        <p id={noteId} className="rq-form-note" data-tone={error ? 'error' : undefined}>
          {note}
        </p>
      )}
    </div>
  );
});
