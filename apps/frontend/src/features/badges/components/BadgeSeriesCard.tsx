import type { BadgeRow } from '../badgeModel';
import { BadgeChip } from './BadgeChip';
import { BadgeEmblem } from './BadgeEmblem';
import { BadgePips } from './BadgePips';
import '../badges.css';

interface BadgeSeriesCardProps {
  /** En rad ur `buildCollection`: intjänad eller låst. Alla texter är redan ihopsatta av modellen. */
  row: BadgeRow;
}

/**
 * Ett samlingskort (spec §4 F2, Council 1, 2, 9, 14), en `<li>` i rutnätet.
 *
 * Intjänat, uppifrån: md-emblem, serienamn (versaler), nivå-chip, pips, kravtext UTAN nivåprefix (--rq-text-2), flavor på egen rad, "Next: …" eller, på maxad
 * serie, guld "TOP TIER REACHED", och held-by. Låst (streckad kant): "Locked"-chip, tomma pips, måttetiketten och "Unlock: Common — …" — ingen flavor, ingen Next
 * och ingen held-by. Valfria rader finns bara när modellen har ett värde; här skrivs aldrig en platshållare.
 *
 * Tillgänglighet: emblemet är dekorativt (kortet läses en gång: namn, nivå, krav). Pips bär "Tier N of 6" på intjänade kort; på låsta kort säger chippet redan
 * "Locked", så pipsen är dekor där.
 */
export function BadgeSeriesCard({ row }: BadgeSeriesCardProps) {
  return (
    <li className="rq-badge-card" data-state={row.earned ? 'earned' : 'locked'}>
      <div className="rq-badge-card__id">
        <BadgeEmblem series={row.series} tier={row.tier} size="md" decorative />
        <div className="rq-badge-card__who">
          <h3 className="rq-name rq-badge-card__name">{row.name}</h3>
          <BadgeChip tier={row.tier} />
          <BadgePips tier={row.tier} decorative={!row.earned} />
        </div>
      </div>

      {row.earned ? (
        <div className="rq-badge-card__body">
          <p className="rq-badge-card__req">{row.requirement}</p>
          {row.flavor && <p className="rq-badge-card__flavor">{`"${row.flavor}"`}</p>}
          {row.maxed ? <p className="rq-badge-card__max">TOP TIER REACHED</p> : row.next && <p className="rq-badge-card__next">{row.next}</p>}
          {row.heldBy && <p className="rq-badge-card__held">{row.heldBy}</p>}
        </div>
      ) : (
        <div className="rq-badge-card__body">
          <p className="rq-badge-card__req">{row.metricLabel}</p>
          {row.unlock && <p className="rq-badge-card__next">{row.unlock}</p>}
        </div>
      )}
    </li>
  );
}
