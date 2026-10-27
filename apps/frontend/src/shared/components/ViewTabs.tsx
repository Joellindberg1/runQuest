import { useEffect, useRef, type KeyboardEvent } from 'react';
import { RQIcon, type RQIconName } from './icons';
import { revealDelta } from './tabReveal';
import { panelId, tabId } from './viewTabIds';
import './view-controls.css';

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

/** Vilken flik en tangent pekar på (pilarna loopar runt, Home/End går till ändarna), eller null för tangenter flikraden inte äger. */
function targetIndex(key: string, current: number, count: number): number | null {
  if (key === 'ArrowRight') return (current + 1) % count;
  if (key === 'ArrowLeft') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/**
 * Delvyernas flikrad över `?view=` (ADR 006 beslut 3). Vald flik = guld 14 %/50 % (regel 4,
 * `.rq-filter`). Piltangenter flyttar markeringen, som en riktig tablist; Home och End går till första och sista fliken.
 */
export function ViewTabs<T extends string>({ label, tabs, value, onChange, idPrefix, variant = 'filter', className }: ViewTabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  // En flikrad som scrollar i sidled (smal skärm, se profile.css) för den valda fliken helt i bild. Rymmer raden alla flikar finns inget att flytta, och bara raden flyttas, aldrig sidan.
  useEffect(() => {
    const list = listRef.current;
    const selectedTab = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!list || !selectedTab || list.scrollWidth <= list.clientWidth) return;
    list.scrollLeft += revealDelta(list.getBoundingClientRect(), selectedTab.getBoundingClientRect());
  }, [value]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const nextIndex = targetIndex(event.key, tabs.findIndex((tab) => tab.key === value), tabs.length);
    if (nextIndex === null) return;
    event.preventDefault();
    const next = tabs[nextIndex];
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
