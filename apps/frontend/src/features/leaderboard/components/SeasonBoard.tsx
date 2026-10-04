import { useMemo } from 'react';
import type { User, UserTitle } from '@runquest/types';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { useOpenRunner } from '@/shared/hooks/useOpenRunner';
import { buildSeasonRows } from '../seasonModel';
import { PodiumCard } from './PodiumCard';
import { RestList, RestTable } from './SeasonRest';

const PODIUM_SIZE = 3;

interface SeasonBoardProps {
  users: User[];
  titlesByUser: Record<string, UserTitle[]>;
  rankDeltaByUser: Record<string, number | null>;
  now: Date;
}

/** Desktop visar podiet som 2 · 1 · 3 med sockel; mobilen listar kortet för kortet i rankordning. */
function desktopPodiumOrder<T>(podium: T[]): T[] {
  if (podium.length === PODIUM_SIZE) return [podium[1], podium[0], podium[2]];
  if (podium.length === 2) return [podium[1], podium[0]];
  return podium;
}

/**
 * Season/All-time-vyn: podium (topp 3) + resten. Ren presentation över users/titlar/rank-delta, så
 * samma komponent driver Board och preview-sidan. En variant i DOM åt gången (≥1024 = desktop).
 */
export function SeasonBoard({ users, titlesByUser, rankDeltaByUser, now }: SeasonBoardProps) {
  const isDesktop = useIsDesktop();
  const openRunner = useOpenRunner();
  const rows = useMemo(
    () => buildSeasonRows(users, { now, titlesByUser, rankDeltaByUser }),
    [users, now, titlesByUser, rankDeltaByUser],
  );

  if (isDesktop === undefined) return null;

  const podium = rows.slice(0, PODIUM_SIZE);
  const rest = rows.slice(PODIUM_SIZE);

  if (isDesktop) {
    return (
      <>
        <div className="rq-board-podium-row" data-count={podium.length}>
          {desktopPodiumOrder(podium).map((row) => (
            <div key={row.id} data-rank={row.rank}>
              <PodiumCard row={row} wide onOpen={openRunner} tourAnchor={row === podium[0]} />
              <div className="rq-plinth rq-board-plinth" aria-hidden="true" />
            </div>
          ))}
        </div>
        <RestTable rows={rest} onOpen={openRunner} />
      </>
    );
  }

  return (
    <>
      <div className="rq-board-podium-list">
        {podium.map((row) => (
          <PodiumCard key={row.id} row={row} wide={false} onOpen={openRunner} tourAnchor={row === podium[0]} />
        ))}
      </div>
      <RestList rows={rest} onOpen={openRunner} />
    </>
  );
}
