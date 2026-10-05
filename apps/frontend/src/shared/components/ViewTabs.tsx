import { useRef, type KeyboardEvent } from 'react';
import { RQIcon, type RQIconName } from './icons';
import { panelId, tabId } from './viewTabIds';

/** Ikonstorleken i flikraden (designen: 13 px i statflikarna). */
const ICON_SIZE = 13;

export interface ViewTab<T extends string> {
  key: T;
  label: string;
  /** Valfri ikon före etiketten (bara i `underline`-varianten används den i designen). */
  icon?: RQIconName;
}

interface ViewTabsProps<T extends string> {
  /** Skärmläsarnamn för flikraden. */
  label: string;
  tabs: readonly ViewTab<T>[];
  value: T;
  onChange: (next: T) => void;
  /** Prefix för id:n — `${idPrefix}-tab-${key}` / `${idPrefix}-panel`, så panelen kan peka tillbaka med aria-labelledby. */
  idPrefix: string;
  /**
   * `filter` (standard): chip-flikar, vald = guld 14 %/50 % (Board). `underline`: understrukna flikar inne i ett kort
   * (Runner card/Profile: statflikarna Distance/Streak/Fun).
   */
  variant?: 'filter' | 'underline';
  className?: string;
}

/**
 * Delvyernas flikrad över `?view=` (ADR 006 beslut 3). Vald flik = guld 14 %/50 % (regel 4,
 * `.rq-filter`). Piltangenter flyttar markeringen, som en riktig tablist.
 */
export function ViewTabs<T extends string>({ label, tabs, value, onChange, idPrefix, variant = 'filter', className }: ViewTabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.key === value);
    const next = tabs[(index + step + tabs.length) % tabs.length];
    onChange(next.key);
    listRef.current?.querySelector<HTMLElement>(`#${tabId(idPrefix, next.key)}`)?.focus();
  };

  return (
    <div ref={listRef} role="tablist" aria-label={label} className={className} onKeyDown={onKeyDown}>
      {tabs.map((tab) => {
        const selected = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={tabId(idPrefix, tab.key)}
            aria-selected={selected}
            aria-controls={panelId(idPrefix)}
            tabIndex={selected ? 0 : -1}
            className={variant === 'underline' ? 'rq-tab' : 'rq-filter'}
            onClick={() => onChange(tab.key)}
          >
            {tab.icon && <RQIcon name={tab.icon} size={ICON_SIZE} />}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
