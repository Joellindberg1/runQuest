import type { ReactNode } from 'react';
import { cssVars } from '@/features/leaderboard/cssVars';
import { RQIcon, type RQIconName } from '@/shared/components/icons';
import { TrackLoader } from '@/shared/components/loaders/TrackLoader';
import type { RunnerHero, Tone } from '../runnerModel';

// Småkomponenter som Runner cardens paneler delar.

/** Nivåringen med sin läsbara etikett: hjältekortet på sidan och popupens banner ritar den lika. */
export function LevelRing({ hero }: { hero: Pick<RunnerHero, 'level' | 'ringTurn' | 'nextLevel'> }) {
  const percent = Math.round(hero.ringTurn * 100);
  const label = hero.nextLevel === null
    ? `Level ${hero.level}, max level`
    : `Level ${hero.level}, ${percent}% of the way to level ${hero.nextLevel}`;

  return (
    <div className="rq-ring rq-runner-ring" role="img" aria-label={label} style={cssVars({ '--rq-ring-p': `${hero.ringTurn}turn` })}>
      <div className="rq-ring-hole">
        <span className="rq-runner-ring__level">{hero.level}</span>
        <span className="rq-runner-ring__caption">level</span>
      </div>
    </div>
  );
}

interface Cell {
  key: string;
  label: string;
  value: string | number;
  tone: Tone;
}

const GRID_CLASS = { cells: 'rq-hairgrid rq-runner-cells', record: 'rq-hairgrid rq-runner-record' } as const;

interface CellGridProps {
  cells: readonly Cell[];
  /** Rutnätets klass: `rq-runner-cells` (statceller) eller `rq-runner-record` (head to head-rekordet). */
  variant: 'cells' | 'record';
  /** Panelen läses som en mening: siffrorna göms för hjälpmedel så att innehållet inte läses två gånger. */
  decorative?: boolean;
}

/** Hårlinjegrid med värde över etikett (Bebas-värde, versal etikett): hjältekortets statceller och head to head-rekordets tre rutor. */
export function CellGrid({ cells, variant, decorative = false }: CellGridProps) {
  return (
    <dl className={GRID_CLASS[variant]} aria-hidden={decorative ? true : undefined}>
      {cells.map((cell) => (
        <div key={cell.key} className="rq-runner-cell" data-cell={cell.key}>
          <dt className="rq-runner-cell__label">{cell.label}</dt>
          <dd className="rq-runner-cell__value" data-tone={cell.tone}>{cell.value}</dd>
        </div>
      ))}
    </dl>
  );
}

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

