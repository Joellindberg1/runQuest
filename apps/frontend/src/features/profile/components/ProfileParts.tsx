import type { ReactNode } from 'react';
import { RQIcon, type RQIconName } from '@/shared/components/icons';
import { TrackLoader } from '@/shared/components/loaders/TrackLoader';

// Småkomponenter som Profiles paneler delar.

const PANEL_LOADER_SIZE = 40;
const HEAD_ICON_SIZE = 17;

/** Laddning inne i en panel: stadion-ovalen (regel 9). */
export function PanelLoading({ label }: { label: string }) {
  return (
    <div className="rq-profile-loading">
      <TrackLoader size={PANEL_LOADER_SIZE} label={label} />
    </div>
  );
}

interface PanelHeadProps {
  icon?: RQIconName;
  title: string;
  /** Skuggad notering efter rubriken ("as Frodo"). */
  note?: string;
  /** Höger sida: räknare ("5 held · 3 runner-up") eller kontroll. */
  aside?: ReactNode;
}

/** Kortrubrik: Bebas guld (`.rq-title`) med valfri guldikon, notering och höger-aside. */
export function PanelHead({ icon, title, note, aside }: PanelHeadProps) {
  return (
    <header className="rq-profile-head">
      {icon && <RQIcon name={icon} size={HEAD_ICON_SIZE} color="var(--rq-gold)" />}
      <h2 className="rq-title rq-profile-head__title">{title}</h2>
      {note && <span className="rq-profile-head__note">{note}</span>}
      {aside !== undefined && <span className="rq-profile-head__aside">{aside}</span>}
    </header>
  );
}
