import { useMemo } from 'react';
import { ErrorState } from '@/shared/components/ErrorState';
import { firstName } from '@/shared/utils/format';
import type { HeadToHeadSource } from '../hooks/useRunnerPanelData';
import { buildHeadToHead, type Meeting, type MeetingResult } from '../runnerModel';
import { CellGrid, PanelLoading } from './RunnerParts';

const RESULT_CHIP: Record<MeetingResult, string> = {
  won: 'rq-chip rq-chip--status rq-chip--up',
  lost: 'rq-chip rq-chip--status rq-chip--down',
  draw: 'rq-chip rq-chip--tag',
};

function MeetingRow({ meeting }: { meeting: Meeting }) {
  return (
    <li className="rq-row rq-runner-meeting">
      <span className={RESULT_CHIP[meeting.result]}>{meeting.resultLabel}</span>
      <span className="rq-runner-meeting__what">
        <span>{meeting.what}</span>
        <span className="rq-runner-meeting__score">{meeting.score}</span>
      </span>
      {meeting.date && <span className="rq-runner-meeting__date">{meeting.date}</span>}
    </li>
  );
}

/**
 * "Head to head" som kort på sidan (mobil och direktladdning): rekordet ur den inloggades perspektiv (you won · drawn · you lost) och de senaste mötena
 * kompakt. Popupen har samma uppgifter som en panel i bannern (`HeadToHeadBanner`). Visas aldrig på egen profil — /runner/<eget id> redirectas till /profile redan i routingen.
 */
export function HeadToHeadPanel({ opponentName, meId, data, isError, isFetching, onRetry }: HeadToHeadSource) {
  const view = useMemo(() => (data ? buildHeadToHead(data, meId) : null), [data, meId]);

  let body;
  if (isError) {
    body = <ErrorState title="Couldn't load head to head" retrying={isFetching} onRetry={onRetry} />;
  } else if (!view) {
    body = <PanelLoading label="Loading head to head" />;
  } else {
    body = (
      <>
        <CellGrid cells={view.cells} variant="record" />
        {view.meetings.length > 0 ? (
          <ol className="rq-hairgrid rq-runner-meetings" aria-label="Latest meetings">
            {view.meetings.map((meeting) => <MeetingRow key={meeting.id} meeting={meeting} />)}
          </ol>
        ) : (
          <p className="rq-runner-note">No duels against {firstName(opponentName)} yet.</p>
        )}
      </>
    );
  }

  return (
    <section className="rq-card rq-runner-h2h" aria-label="Head to head">
      <h2 className="rq-label rq-runner-sub">Head to head</h2>
      {body}
    </section>
  );
}
