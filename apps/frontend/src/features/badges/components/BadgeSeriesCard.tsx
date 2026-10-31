import type { ReactNode } from 'react';
import type { BadgeRow } from '../badgeModel';
import { BadgeChip } from './BadgeChip';
import { BadgeEmblem } from './BadgeEmblem';
import { BadgePips } from './BadgePips';
import '../badges.css';

/**
 * Växlarens tillstånd på det liggande kortet (spec F9.6). Sidan äger utkastet (`useShowcaseDraft`) och den synliga 3-av-3-texten; kortet bara ritar läget.
 * Läget härleds: `position` satt = "On display — N"; annars `full` = avstängd med `aria-describedby`; `saving` stänger av alla (den valda behåller guldutseendet).
 */
export interface ShowcaseToggle {
  /** 1-baserad plats i utkastet, null = inte vald. */
  position: number | null;
  /** Utkastet är fullt (MAX_SHOWCASE): en icke-vald växlare är avstängd och pekar på `limitId`. */
  full: boolean;
  /** Sparandet pågår: alla växlare är avstängda och klicken ignoreras. */
  saving: boolean;
  /** id på den SYNLIGA meningen "3 of 3 on display — remove one first." som sidan äger (permanent behållare, `aria-live`). */
  limitId: string;
  onToggle: () => void;
}

interface BadgeSeriesCardProps {
  /** En rad ur `buildCollection`: intjänad eller låst. Alla texter är redan ihopsatta av modellen. */
  row: BadgeRow;
  /**
   * Visningsväxlaren. Utan den är kortet skrivskyddat: ingen växlare och ingen "Locked"-ruta (de hör till samlingen på /badges), och bara det som förklarar serien
   * (namn, nivå, pips, krav, held-by), alltså varken flavor, Next eller "TOP TIER REACHED". Löparens popup ritar korten så.
   */
  toggle?: ShowcaseToggle;
}

/** Växlaren på ett intjänat kort. En `<button aria-pressed>`: den dimmas (aria-disabled) men lämnar aldrig tabbordningen, så skälet kan läsas. */
function ShowcaseSwitch({ row, toggle }: { row: BadgeRow; toggle: ShowcaseToggle }) {
  const on = toggle.position !== null;
  const blocked = !on && toggle.full;
  const disabled = toggle.saving || blocked;
  return (
    <button
      type="button"
      className="rq-badge-toggle"
      data-series={row.series}
      aria-pressed={on}
      aria-disabled={disabled ? true : undefined}
      aria-describedby={blocked ? toggle.limitId : undefined}
      onClick={() => {
        if (!disabled) toggle.onToggle();
      }}
    >
      <span className="sr-only">{row.name}: </span>
      {on ? `On display — ${toggle.position}` : 'Show'}
    </button>
  );
}

/** Kroppen under namnraden. `children` är raden längst ned (held-by, och på det liggande kortet växlaren). `collection` = samlingens kort (med växlare): flavor och Next hör bara dit. */
function Details({ row, collection, children }: { row: BadgeRow; collection: boolean; children?: ReactNode }) {
  return row.earned ? (
    <>
      <p className="rq-badge-card__req">{row.requirement}</p>
      {collection && row.flavor && <p className="rq-badge-card__flavor">{`"${row.flavor}"`}</p>}
      {collection && (row.maxed ? <p className="rq-badge-card__max">TOP TIER REACHED</p> : row.next && <p className="rq-badge-card__next">{row.next}</p>)}
      {children}
    </>
  ) : (
    <>
      <p className="rq-badge-card__req">{row.metricLabel}</p>
      {row.unlock && <p className="rq-badge-card__next">{row.unlock}</p>}
      {children}
    </>
  );
}

/**
 * Ett samlingskort (spec v2 F9.5, liggande; Council 1, 2, 9, 14, 17), en `<li>` i badges-sidans rutnät. Det stående kortet (v1 F2) togs bort i RUN-151 när profilens
 * samlingskort ersattes av sammanfattningen; sidan är nu kortets enda användare.
 *
 * Intjänat: serienamn (versaler), nivå-chip, pips, kravtext UTAN nivåprefix (--rq-text-2), flavor på egen rad, "Next: …" eller, på maxad serie, guld "TOP TIER REACHED",
 * och held-by. Låst (streckad kant): "Locked"-chip, tomma pips, måttetiketten och "Unlock: Common — …" — ingen flavor, ingen Next och ingen held-by.
 * Valfria rader finns bara när modellen har ett värde; här skrivs aldrig en platshållare. Ingen global procent (O2).
 *
 * Tre rutnätsområden (emblem · who · body) ur `--rq-badge-card-areas`, och växlaren längst ned i body, till höger om held-by.
 * Kortet i sig är inte klickbart; växlaren är dess enda interaktiva element. Utan `toggle` är kortet skrivskyddat (förklaringskortet i löparens popup): inget interaktivt alls,
 * och bara namn, nivå-chip, pips, krav och held-by.
 *
 * Tillgänglighet: emblemet är dekorativt (kortet läses en gång: namn, nivå, krav). Pips bär "Tier N of 6" på intjänade kort; på låsta kort säger chippet redan "Locked",
 * så pipsen är dekor där. Låst serie = ingen knapp, bara en aria-hidden "Locked"-ruta.
 */
export function BadgeSeriesCard({ row, toggle }: BadgeSeriesCardProps) {
  const heldBy = row.earned && row.heldBy ? <p className="rq-badge-card__held">{row.heldBy}</p> : null;
  // Skrivskyddat kort: held-by står ensam och raden finns bara när den har något att visa.
  let foot: ReactNode = heldBy && <div className="rq-badge-card__foot">{heldBy}</div>;
  if (toggle) {
    foot = (
      <div className="rq-badge-card__foot">
        {heldBy}
        {row.earned ? <ShowcaseSwitch row={row} toggle={toggle} /> : <span className="rq-badge-toggle rq-badge-toggle--locked" aria-hidden="true">Locked</span>}
      </div>
    );
  }

  return (
    <li
      className="rq-badge-card rq-badge-card--landscape"
      data-state={row.earned ? 'earned' : 'locked'}
      data-display={row.earned && toggle && toggle.position !== null ? 'true' : undefined}
    >
      <div className="rq-badge-card__emblem">
        <BadgeEmblem series={row.series} tier={row.tier} size="md" decorative />
      </div>
      <div className="rq-badge-card__who">
        <h3 className="rq-name rq-badge-card__name">{row.name}</h3>
        <BadgeChip tier={row.tier} />
        <BadgePips tier={row.tier} decorative={!row.earned} />
      </div>
      <div className="rq-badge-card__body">
        <Details row={row} collection={toggle !== undefined}>{foot}</Details>
      </div>
    </li>
  );
}
