import type { ReactNode } from 'react';
import { RQIcon, type RQIconName } from '@/shared/components/icons';
import { TrackLoader } from '@/shared/components/loaders/TrackLoader';

// Småkomponenter som Runner cardens paneler delar.

const PANEL_LOADER_SIZE = 40;

/** Laddning inne i en panel: stadion-ovalen (regel 9). */
export function PanelLoading({ label }: { label: string }) {
  return (
    <div className="rq-runner-loading">
      <TrackLoader size={PANEL_LOADER_SIZE} label={label} />
    </div>
  );
}

interface PanelHeadProps {
  icon?: RQIconName;
  title: string;
  /** Höger sida: räknare ("4 held") eller kontroll. */
  aside?: ReactNode;
}

/** Kortrubrik: Bebas guld (`.rq-title`) med valfri guldikon och höger-aside. */
export function PanelHead({ icon, title, aside }: PanelHeadProps) {
  return (
    <header className="rq-runner-head">
      {icon && <RQIcon name={icon} size={17} color="var(--rq-gold)" />}
      <h2 className="rq-title rq-runner-head__title">{title}</h2>
      {aside !== undefined && <span className="rq-runner-head__aside">{aside}</span>}
    </header>
  );
}

