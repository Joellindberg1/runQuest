import { useMemo, useRef, useState } from 'react';
import type { Run } from '@runquest/types';
import { paths } from '@/paths';
import { EmptyState } from '@/shared/components/EmptyState';
import { HISTORY_PREVIEW_COUNT, buildRunRows, buildRunTimeSummary, isStravaRun, showAllLabel, type RunTimeCell } from '../profileModel';
import { EditRunSheet } from './EditRunSheet';

interface RunHistoryProps {
  runs: Run[];
  /** Stockholm-dagen (redigeringsrutans datumgräns). */
  today: string;
}

interface TimeAndPaceProps {
  cell: RunTimeCell;
  timeLabel: 'Time' | 'Total time';
  className: string;
  /** Namn på gruppen (summan); raderna ligger redan i en lista och behöver inget. */
  group?: string;
  basis?: string | null;
}

/**
 * Tid och tempo på en rad, och samma form för summan. Skärmläsaren får EN mening (`cell.label`: "Time 52:10, pace 5:13 per kilometre" eller
 * "no time recorded"); de synliga fälten är dolda för den så att "1:09:40" aldrig läses som ett klockslag och tankstrecket aldrig läses som "dash".
 */
function TimeAndPace({ cell, timeLabel, className, group, basis }: TimeAndPaceProps) {
  return (
    <div className={className} role={group ? 'group' : undefined} aria-label={group}>
      <span className="sr-only">{cell.label}</span>
      <span className="rq-profile-run__pair" aria-hidden="true">
        <span className="rq-profile-run__tlabel">{timeLabel}</span>
        <span className="rq-profile-run__tvalue">{cell.time}</span>
      </span>
      <span className="rq-profile-run__pair" aria-hidden="true">
        <span className="rq-profile-run__tlabel">Pace</span>
        <span className="rq-profile-run__tvalue">{cell.pace}</span>
      </span>
      {basis && <span className="rq-profile-history__basis">{basis}</span>}
    </div>
  );
}

/**
 * RUN HISTORY: mina rundor, nyast först. Fyra rader tills "Show all N runs" (båda prototyperna). Varje rad har Edit (Strava-rundor: View, skrivskyddat), som öppnar
 * redigera/radera-rutan; bekräftelsen efter en ändring ligger i en permanent live-region (statusregion i stället för toast).
 */
export function RunHistory({ runs, today }: RunHistoryProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<Run | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const rows = useMemo(() => buildRunRows(runs), [runs]);
  const visible = expanded ? rows : rows.slice(0, HISTORY_PREVIEW_COUNT);
  const toggleLabel = showAllLabel(rows.length);
  // Summan gäller de rundor kortet visar just nu: fyra tills "Show all N runs", sedan alla.
  const summary = buildRunTimeSummary(visible.map((row) => row.run));

  return (
    <section className="rq-card rq-profile-history" aria-label="Run history" data-tour="profile-history">
      <h2 className="rq-title rq-profile-history__head">RUN HISTORY</h2>

      {/* Live regions måste finnas innan texten kommer för att annonseras: behållaren är permanent, bara texten monteras. */}
      <div ref={statusRef} role="status" tabIndex={-1} className="rq-profile-notice-slot rq-profile-history__notice">
        {notice && <p className="rq-profile-notice">{notice}</p>}
      </div>

      {rows.length === 0 ? (
        <EmptyState headingLevel="h2" title="No runs yet" text="Log your first run and it shows up here, ready to edit." actionLabel="Log a run" actionTo={paths.log} />
      ) : (
        <>
          <ul className="rq-hairgrid rq-profile-history__list" aria-label="Your runs">
            {visible.map((row) => (
              <li key={row.id} className="rq-row rq-profile-run">
                <div>
                  <p className="rq-profile-run__date">{row.date}</p>
                  <p className="rq-profile-run__meta">{row.meta}</p>
                </div>
                <div className="rq-profile-run__earned">
                  <p className="rq-profile-run__xp">{row.xp}</p>
                  <p className="rq-profile-run__mult">{row.multiplier}</p>
                </div>
                <button type="button" className="rq-btn rq-btn--ghost rq-btn--compact" aria-label={`${isStravaRun(row.run) ? 'View' : 'Edit'} run ${row.date}`} onClick={(event) => { openerRef.current = event.currentTarget; setNotice(null); setEditing(row.run); }}>
                  {/* Strava-rundor går inte att redigera (RUN-139): arket är skrivskyddat, så knappen heter View. */}
                  {isStravaRun(row.run) ? 'View' : 'Edit'}
                </button>
                <TimeAndPace cell={row.timing} timeLabel="Time" className="rq-profile-run__time" />
              </li>
            ))}
          </ul>
          <TimeAndPace cell={summary} timeLabel="Total time" className="rq-profile-history__sum" group="Time of the runs shown" basis={summary.basis} />
          {toggleLabel && (
            <div className="rq-profile-history__foot">
              <button type="button" className="rq-btn rq-btn--ghost rq-btn--compact rq-profile-more" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
                {expanded ? 'Show fewer' : toggleLabel}
              </button>
            </div>
          )}
        </>
      )}

      {editing && (
        <EditRunSheet
          key={editing.id}
          run={editing}
          today={today}
          onClose={() => setEditing(null)}
          onDone={(text) => { setEditing(null); setNotice(text); }}
          onRestoreFocus={(done) => (done ? statusRef.current : openerRef.current)?.focus()}
        />
      )}
    </section>
  );
}
