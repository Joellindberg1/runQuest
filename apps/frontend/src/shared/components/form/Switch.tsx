import { useId } from 'react';
import './form.css';

export interface SwitchProps {
  /** Meningen vid reglaget. Den är switchens namn (aria-labelledby). */
  label: string;
  /** Kort anteckning under meningen ("Off by default"). Den blir switchens beskrivning, inte en del av namnet. */
  note?: string;
  checked: boolean;
  /** Anropas med det nya läget. Anropas aldrig när reglaget är inaktiverat. */
  onCheckedChange: (next: boolean) => void;
  /** `aria-disabled`, inte `disabled`: reglaget behåller fokus och går att läsa med skärmläsare (t.ex. när inställningarna inte kunde läsas). */
  disabled?: boolean;
  /** En tystare mening (rader som rör andra än dig). */
  quiet?: boolean;
}

/**
 * Reglaget som en hel rad: en `button role="switch"` där raden är tryckytan (46 px på desktop, 52 på mobil) och spåret är ren dekor.
 * På är grönt (ägarbeslut 2026-10-14, --rq-toggle-on), av är en ram + knoppen till vänster; läget syns alltså inte bara på färgen.
 * Header-växlaren för tema (app-shell/ThemeSwitch) är en annan komponent och förblir guld.
 */
export function Switch({ label, note, checked, onCheckedChange, disabled = false, quiet = false }: SwitchProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const noteId = `${id}-note`;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      aria-labelledby={labelId}
      aria-describedby={note ? noteId : undefined}
      data-tone={quiet ? 'quiet' : undefined}
      className="rq-switch-row"
      onClick={() => {
        if (!disabled) onCheckedChange(!checked);
      }}
    >
      <span className="rq-switch-row__text">
        <span id={labelId} className="rq-switch-row__label">
          {label}
        </span>
        {note && (
          <span id={noteId} className="rq-switch-row__note">
            {note}
          </span>
        )}
      </span>
      <span className="rq-switch" aria-hidden="true" />
    </button>
  );
}
