import { useEffect, useRef } from 'react';
import type { User } from '@runquest/types';
import { cssVars } from '@/features/leaderboard/cssVars';
import { HEAT_MONTHS_DESKTOP, HEAT_MONTHS_MOBILE, buildHeatStats, buildHeatmap, type HeatCell, type HeatLevel } from '../heatmapModel';
import { formatInt, formatKm } from '../profileFormat';

/** Veckodagsetiketterna (desktop): mån · · ons · · fre · · sön — varannan, som Web Prototype. */
const DAY_LABELS = ['M', '', 'W', '', 'F', '', 'S'] as const;
const LEGEND_LEVELS: readonly HeatLevel[] = [0, 1, 2, 3, 4];

function cellTitle(cell: HeatCell): string | undefined {
  if (cell.runs === 0) return undefined;
  return `${cell.date} · ${formatKm(cell.km)} km${cell.runs > 1 ? ` · ${cell.runs} runs` : ''}`;
}

interface HeatmapProps {
  user: User;
  /** Stockholm-dagen. */
  today: string;
  now: Date;
  isDesktop: boolean;
}

/**
 * Consistency: en ruta per dag, veckor som kolumner grupperade per månad. Desktop 12 månader med veckodagsetiketter och
 * förklaring (Less → More), mobil 6 månader. Rutorna växer in EN gång (rqGrowY, stagger per vecka) och står sedan still.
 * Rutnätet är dekor för skärmläsare — sammanfattningen ligger i regionens namn.
 */
export function Heatmap({ user, today, now, isDesktop }: HeatmapProps) {
  const months = isDesktop ? HEAT_MONTHS_DESKTOP : HEAT_MONTHS_MOBILE;
  const heat = buildHeatmap(user.runs ?? [], today, months);
  const stats = buildHeatStats(user, heat, now);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Är raden bredare än kortet visas den nyaste delen (innevarande månad), inte den äldsta.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [months]);

  return (
    <div className="rq-profile-heat">
      <div className="rq-profile-heat__top">
        <span className="rq-profile-heat__total">{formatInt(heat.runs)}</span>
        <span className="rq-profile-heat__unit">{isDesktop ? 'runs in the last 12 months' : 'runs · 6 months'}</span>
      </div>

      <div className="rq-profile-heat__body">
        {isDesktop && (
          <div className="rq-profile-heat__days" aria-hidden="true">
            {DAY_LABELS.map((label, index) => (
              <span key={index} className="rq-profile-heat__day">{label}</span>
            ))}
          </div>
        )}
        {/* Scrollbar region: tangentbordsfokus gör att den går att panorera utan mus. */}
        <div ref={scrollRef} className="rq-profile-heat__scroll" role="region" aria-label={`Run heatmap: ${heat.summary}`} tabIndex={0}>
          <div className="rq-profile-heat__months">
            {heat.months.map((month) => (
              <div key={month.key} className="rq-profile-heat__month" data-current={month.current}>
                <div className="rq-profile-heat__month-label">{month.label}</div>
                <div className="rq-profile-heat__weeks">
                  {month.weeks.map((week) => (
                    <div key={week.index} className="rq-profile-heat__week" style={cssVars({ '--i': String(week.index) })}>
                      {week.cells.map((cell) => (
                        <div
                          key={cell.date}
                          className="rq-profile-heat__cell"
                          data-level={cell.level === null ? 'future' : cell.level}
                          data-today={cell.today || undefined}
                          title={cellTitle(cell)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="rq-profile-heat__today">
        <span className="rq-profile-heat__cell" data-level="2" data-today="true" aria-hidden="true" />
        {heat.todayLabel}
      </p>

      <div className="rq-profile-heat__bottom">
        <dl className="rq-profile-heat__stats">
          {stats.map((stat) => (
            <div key={stat.key} className="rq-profile-heat__stat" data-stat={stat.key}>
              <dt className="rq-profile-heat__stat-label">{stat.label}</dt>
              <dd className="rq-profile-heat__stat-value" data-tone={stat.tone}>{stat.value}</dd>
            </div>
          ))}
        </dl>
        {isDesktop && (
          <div className="rq-profile-heat__legend" aria-hidden="true">
            <span>Less</span>
            {LEGEND_LEVELS.map((level) => (
              <span key={level} className="rq-profile-heat__swatch" data-level={level} />
            ))}
            <span>More</span>
          </div>
        )}
      </div>
    </div>
  );
}
