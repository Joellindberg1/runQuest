import { BADGE_SERIES } from '@runquest/shared';
import { RQIcon, type RQIconName } from '@/shared/components/icons';
import { cn } from '@/lib/utils';
import { isEarnedTier, tierKey, tierName } from './badgeTier';
import '../badges.css';

export type BadgeSize = 'sm' | 'md' | 'lg';

export interface BadgeEmblemProps {
  /** Serienyckeln (`BadgeUserItem.series`). Namn och ikon läses ur BADGE_SERIES. */
  series: string;
  /** 1..6 = nivån, null (eller allt ogiltigt) = låst. */
  tier: number | null;
  /** sm 28 px (rader, Board, News), md 56 px (samlingskort), lg 96 px (popupen). */
  size: BadgeSize;
  /** Engångständning (0.9 s) — bara uppgraderingspopupen sätter den. Låsta serier tänds aldrig. */
  ignite?: boolean;
  /** Dekorativt: aria-hidden utan etikett (Board-grupper, News-rader — den omgivande texten bär betydelsen). */
  decorative?: boolean;
}

const SERIES_BY_KEY = new Map<string, (typeof BADGE_SERIES)[number]>(BADGE_SERIES.map((series) => [series.key, series]));

/** Etiketten skärmläsare och tooltip får: "Rare Milestoner", låst "Locked Milestoner". Nivån bärs aldrig av färg ensam (Council 5). */
function emblemLabel(tier: number | null, seriesName: string): string {
  const name = tierName(tier);
  return name ? `${name} ${seriesName}` : `Locked ${seriesName}`;
}

/**
 * Badge-emblemet (ADR 009, spec §3): kronsköld i CSS (`clip-path`) i fem lager — glow-wrapper, ram med nivåns gradient, Heroic-ring, mörk kärna
 * och serieikonen (RQIcon, aldrig egen svg). All form, färg och glöd ligger i badges.css och `--rq-badge-*`-tokens; komponenten väljer bara
 * klasser och `data-tier`. Rörelsen (tändning, Legendary-andning) är också ren CSS.
 */
export function BadgeEmblem({ series, tier, size, ignite = false, decorative = false }: BadgeEmblemProps) {
  const def = SERIES_BY_KEY.get(series);
  const earned = isEarnedTier(tier);
  const key = tierKey(tier);
  const heroic = key === 'heroic';
  const a11y = decorative
    ? { 'aria-hidden': true as const }
    : { role: 'img', 'aria-label': emblemLabel(tier, def?.name ?? series), title: emblemLabel(tier, def?.name ?? series) };

  return (
    <span className={cn('rq-badge', `rq-badge--${size}`, ignite && earned && 'rq-badge--ignite')} data-tier={key} {...a11y}>
      <span className="rq-badge__frame">
        {heroic && <span className="rq-badge__ring" />}
        <span className="rq-badge__core">
          {/* Okänd serie: RQIcon faller tillbaka på reservikonen i stället för att rita ingenting. */}
          <RQIcon name={(def?.icon ?? series) as RQIconName} className="rq-badge__icon" />
        </span>
      </span>
    </span>
  );
}
