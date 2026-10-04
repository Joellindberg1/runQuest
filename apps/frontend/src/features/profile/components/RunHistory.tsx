import { useMemo, useState } from 'react';
import type { Run } from '@runquest/types';
import { paths } from '@/paths';
import { EmptyState } from '@/shared/components/EmptyState';
import { HISTORY_PREVIEW_COUNT, buildRunRows, showAllLabel } from '../profileModel';
import { EditRunSheet } from './EditRunSheet';

interface RunHistoryProps {
  runs: Run[];
  /** Stockholm-dagen (redigeringsrutans datumgräns). */
  today: string;
}

/**
 * RUN HISTORY: mina rundor, nyast först. Fyra rader tills "Show all N runs" (båda prototyperna). Varje rad har Edit, som öppnar
 * redigera/radera-rutan; bekräftelsen efter en ändring ligger i en permanent live-region (Toaster är inte monterad i appen).
 */
export function RunHistory({ runs, today }: RunHistoryProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<Run | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const rows = useMemo(() => buildRunRows(runs), [runs]);
  const visible = expanded ? rows : rows.slice(0, HISTORY_PREVIEW_COUNT);
  const toggleLabel = showAllLabel(rows.length);

  return (
    <section className="rq-card rq-profile-history" aria-label="Run history" data-tour="profile-history">
      <h2 className="rq-title rq-profile-history__head">RUN HISTORY</h2>

      {/* Live regions måste finnas innan texten kommer för att annonseras: behållaren är permanent, bara texten monteras. */}
      <div role="status" className="rq-profile-notice-slot rq-profile-history__notice">
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
                <button type="button" className="rq-btn rq-btn--ghost rq-btn--compact" aria-label={`Edit run ${row.date}`} onClick={() => { setNotice(null); setEditing(row.run); }}>
                  Edit
                </button>
              </li>
            ))}
          </ul>
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
        />
      )}
    </section>
  );
}
