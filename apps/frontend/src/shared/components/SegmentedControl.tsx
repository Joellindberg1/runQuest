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
}

/**
 * Växling mellan lägen av samma innehåll (Overview-växlingen, titelfiltret i popupen): en grupp knappar där exakt en är vald (`aria-pressed`).
 * Till skillnad från ViewTabs byter den inte panel, så den är en grupp av knappar och ingen tablist; varje knapp är ett eget tabbstopp.
 * Utseendet är `.rq-filter` (vald = guld 14 %/50 %).
 */
export function SegmentedControl<T extends string>({ label, options, value, onChange, className }: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label} className={className ? `rq-segmented ${className}` : 'rq-segmented'}>
      {options.map((option) => (
        <button key={option.value} type="button" className="rq-filter" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
