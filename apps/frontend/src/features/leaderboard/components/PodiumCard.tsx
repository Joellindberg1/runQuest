import { RQIcon } from '@/shared/components/icons';
import { titleLine, type SeasonRow } from '../seasonModel';
import { ChallengeRibbons, DeltaMark, RunnerAvatar, RunnerName } from './BoardParts';
import { cssVars } from '../cssVars';

const RANK_STAGGER_SECONDS = 0.1;
const ICON_CROWN = 15;

interface StatCellProps {
  value: string;
  label: string;
  tone?: 'rank' | 'up' | 'down';
}

function StatCell({ value, label, tone }: StatCellProps) {
  return (
    <div className="rq-board-stat">
      <div className="rq-board-stat__value" data-tone={tone}>{value}</div>
      <div className="rq-label">{label}</div>
    </div>
  );
}

function nextLevelText(row: SeasonRow): string {
  if (row.nextLevelDays !== null) return `${row.nextLevelDays} d`;
  return row.progress.atMax ? 'max' : '—';
}

function hintText(row: SeasonRow, wide: boolean): string {
  if (row.tokensLeft > 0) return `${row.tokensLeft} left`;
  return wide ? 'none left' : 'none';
}

interface PodiumCardProps {
  row: SeasonRow;
  /** Desktopvarianten (≥1024): titelrad, tempo i 2×2 och "Challenges to send". */
  wide: boolean;
  onOpen: (userId: string) => void;
  /** Ankare för leaderboard-touren (först ut på podiet). */
  tourAnchor?: boolean;
}

/** Podiekortet (kortvariant 3/3): rankfärgad kant, spökrank, glöd på #1. Klick → Runner card. */
export function PodiumCard({ row, wide, onOpen, tourAnchor }: PodiumCardProps) {
  const open = () => onOpen(row.id);
  const fillVars = cssVars({ '--w': `${row.progress.pct}%`, '--rq-delay': `${row.rank * RANK_STAGGER_SECONDS}s` });

  return (
    <article
      className="rq-card rq-card--podium rq-board-podium"
      data-rank={row.rank}
      data-testid={`podium-${row.rank}`}
      {...(tourAnchor ? { 'data-tour': 'leaderboard-card' } : {})}
      onClick={open}
    >
      <span className="rq-ghost-rank" aria-hidden="true">{row.rank}</span>
      <div className="rq-board-podium__body">
        <div className="rq-board-podium__head">
          <RunnerAvatar initials={row.initials} pictureUrl={row.pictureUrl} />
          <div className="rq-board-podium__id">
            {wide ? (
              <>
                <div className="rq-board-podium__nameline">
                  <span className="rq-board-lvl">Lvl {row.level}</span>
                  <DeltaMark delta={row.delta} />
                </div>
                <RunnerName name={row.name} onOpen={open} />
                <div className="rq-board-titleline" data-empty={row.titleNames.length === 0}>
                  <RQIcon name="crown" size={ICON_CROWN} />
                  <span>{titleLine(row.titleNames, row.heldTitleCount)}</span>
                </div>
              </>
            ) : (
              <>
                <div className="rq-board-podium__nameline">
                  <RunnerName name={row.name} onOpen={open} />
                  <DeltaMark delta={row.delta} />
                </div>
                <div className="rq-meta">
                  Lvl {row.level}{row.titleNames[0] ? ` · ${row.titleNames[0]}` : ''}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="rq-board-xprow rq-label">
          <span>Level {row.level}</span>
          <span>{row.progress.into}</span>
        </div>
        <div className="rq-track rq-board-track">
          <div className="rq-fill" style={fillVars} />
        </div>

        <div className="rq-hairgrid rq-board-stats">
          <StatCell value={row.kmTotal} label="km total" tone="rank" />
          <StatCell value={row.longest} label="longest" />
          <StatCell value={String(row.runs)} label="runs" />
        </div>

        {wide ? (
          <div className="rq-board-pace rq-board-podium__pace">
            <div>
              <div className="rq-label">Avg per run</div>
              <div className="rq-board-pace__value">{row.avgPerRun} km</div>
            </div>
            <div>
              <div className="rq-label">XP / day · 14 d</div>
              <div className="rq-board-pace__value" data-tone={row.pace.tone}>{row.pace.text}</div>
            </div>
            <div>
              <div className="rq-label">Next level</div>
              <div className="rq-board-pace__value" data-tone="rank">{nextLevelText(row)}</div>
            </div>
            <div>
              <div className="rq-label">Last run</div>
              <div className="rq-board-pace__value">{row.lastRun ? row.lastRun.age : 'No runs yet'}</div>
            </div>
          </div>
        ) : (
          <div className="rq-hairgrid rq-board-stats">
            <StatCell value={row.avgPerRun} label="avg / run" />
            <StatCell value={row.pace.text} label="xp pace" tone={row.pace.tone} />
            <StatCell value={nextLevelText(row)} label="next lvl" tone="rank" />
          </div>
        )}

        <div className="rq-board-podium__foot">
          {wide ? (
            <span className="rq-label">Challenges to send</span>
          ) : (
            <span className="rq-board-lastrun">
              {row.lastRun ? `Last run ${row.lastRun.age} · ${row.lastRun.km} km` : 'No runs yet'}
            </span>
          )}
          <span className="rq-board-podium__foot-end">
            <ChallengeRibbons tokens={row.tokens} />
            <span className="rq-board-hint" data-empty={row.tokensLeft === 0}>{hintText(row, wide)}</span>
          </span>
        </div>
      </div>
    </article>
  );
}
