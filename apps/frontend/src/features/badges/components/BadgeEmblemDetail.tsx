import * as Popover from '@radix-ui/react-popover';
import type { BadgeRow } from '../badgeModel';
import { BadgeChip } from './BadgeChip';
import { BadgeEmblem } from './BadgeEmblem';
import { BadgePips } from './BadgePips';
import '../badges.css';

// Samma avstånd som klockans popover i skalet (NotificationsPopover): popovern håller sig 12 px från skärmkanten.
const COLLISION_PADDING = 12;
const SIDE_OFFSET = 8;

interface BadgeEmblemDetailProps {
  /** En rad ur `buildCollection` eller `buildRunnerBadges`: intjänad eller låst. Alla texter är redan ihopsatta av modellen. */
  row: BadgeRow;
}

/** "Rare Milestoner", låst "Locked Milestoner": samma sträng som emblemets egen etikett (BadgeEmblem), så knappen och emblemet säger likadant. */
function triggerLabel(row: BadgeRow): string {
  return row.tierName ? `${row.tierName} ${row.name}` : `Locked ${row.name}`;
}

/**
 * Det kompakta 44 px-emblemet som en knapp med en detaljpopover (spec F10.4 / F11, Leads beslut Q2): nivån och kravet utan tooltip, nåbara med tryck och tangentbord.
 * Delas av profilens sammanfattning och Runner card-panelen.
 *
 * Knappen är en `<button>` med det DEKORATIVA emblemet inuti och namnet "{Nivå} {Serie}" ("Locked {Serie}" för låsta); ingen `title` (dubbelläsning). Radix Popover
 * ger `aria-haspopup`, `aria-expanded`, `aria-controls`, Escape/tryck utanför/nytt tryck stänger, fokus in vid öppning och tillbaka till knappen vid stängning, och
 * en öppen popover åt gången (ett tryck på ett annat emblem är ett tryck utanför).
 *
 * Innehåll: "On display" (bara intjänad och i det sparade valet), serienamn + nivåchip, pips, krav (utan nivåprefix), flavor på egen rad, held-by. Låst: Locked-chip,
 * måttetiketten och "Unlock: Common — …", aldrig flavor eller held-by (Council 1). Ingen Next-rad (den bor på badges-sidan), ingen global siffra, ingen animation.
 */
export function BadgeEmblemDetail({ row }: BadgeEmblemDetailProps) {
  const onDisplay = row.earned && row.displayPosition !== null;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="rq-badge-detail__trigger" aria-label={triggerLabel(row)}>
          <BadgeEmblem series={row.series} tier={row.tier} size="cp" decorative />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={SIDE_OFFSET}
          collisionPadding={COLLISION_PADDING}
          aria-label={row.name}
          className="rq-popover rq-badge-detail"
        >
          {onDisplay && <p className="rq-badge-detail__display">On display</p>}
          <div className="rq-badge-detail__head">
            <h3 className="rq-name rq-badge-detail__name">{row.name}</h3>
            <BadgeChip tier={row.tier} />
          </div>
          <BadgePips tier={row.tier} decorative={!row.earned} />
          {row.earned ? (
            <>
              <p className="rq-badge-detail__req">{row.requirement}</p>
              {row.flavor && <p className="rq-badge-detail__flavor">{`"${row.flavor}"`}</p>}
              {row.heldBy && <p className="rq-badge-detail__held">{row.heldBy}</p>}
            </>
          ) : (
            <>
              <p className="rq-badge-detail__req">{row.metricLabel}</p>
              {row.unlock && <p className="rq-badge-detail__unlock">{row.unlock}</p>}
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
