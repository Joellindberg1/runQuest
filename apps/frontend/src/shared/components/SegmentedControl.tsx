import { useRef, type KeyboardEvent } from 'react';
import './view-controls.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  /** Skärmläsarnamn för gruppen ("Overview", "Title filter"). */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
  /**
   * Ett tabbstopp och piltangenter: bara den valda knappen nås med Tab, och pilarna väljer och fokuserar nästa och föregående (de loopar), Home och End går till ändarna. Utelämnad
   * (standard) = varje knapp är ett eget tabbstopp, som Overview-växlingen och titelfiltret.
   */
  roving?: boolean;
}

/** Vilken knapp en tangent pekar på (pilarna loopar runt, Home/End går till ändarna), eller null för tangenter gruppen inte äger. Samma regel som flikraden (ViewTabs). */
function targetIndex(key: string, current: number, count: number): number | null {
  if (key === 'ArrowRight') return (current + 1) % count;
  if (key === 'ArrowLeft') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/**
 * Växling mellan lägen av samma innehåll (Overview-växlingen, titelfiltret i popupen, Position-vyns Last 8 weeks/All time): en grupp knappar där exakt en är vald (`aria-pressed`).
 * Till skillnad från ViewTabs byter den inte panel, så den är en grupp av knappar och ingen tablist; som standard är varje knapp ett eget tabbstopp (`roving` ger ett tabbstopp och pilar).
 * Utseendet är `.rq-filter` (vald = guld 14 %/50 %).
 */
export function SegmentedControl<T extends string>({ label, options, value, onChange, className, roving = false }: SegmentedControlProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Ctrl/Meta/Alt/Shift + tangent är webbläsarens (Alt+Vänster = bakåt): gruppen fångar den inte och hindrar den inte.
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const nextIndex = targetIndex(event.key, options.findIndex((option) => option.value === value), options.length);
    if (nextIndex === null) return;
    event.preventDefault();
    onChange(options[nextIndex].value);
    groupRef.current?.querySelectorAll<HTMLElement>('button')[nextIndex]?.focus();
  };

  return (
    <div ref={groupRef} role="group" aria-label={label} className={className ? `rq-segmented ${className}` : 'rq-segmented'} onKeyDown={roving ? onKeyDown : undefined}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button key={option.value} type="button" className="rq-filter" aria-pressed={selected} tabIndex={roving ? (selected ? 0 : -1) : undefined} onClick={() => onChange(option.value)}>
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
