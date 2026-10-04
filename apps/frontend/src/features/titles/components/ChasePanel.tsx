import type { Chase } from '../titlesModel';

/** "CLOSEST CHASE" (desktop): de titlar som ligger närmast mig, med avstånd och vem det gäller. */
export function ChasePanel({ chases }: { chases: Chase[] }) {
  return (
    <section className="rq-card rq-titles-side" aria-label="Closest chase">
      <header className="rq-titles-side__head">
        <h2 className="rq-title rq-titles-side__title">CLOSEST CHASE</h2>
      </header>
      {chases.length === 0 ? (
        <p className="rq-titles-note">Nothing to chase right now.</p>
      ) : (
        <ul className="rq-titles-chases">
          {chases.map((chase) => (
            <li key={chase.titleId} className="rq-titles-chase" data-kind={chase.kind}>
              <span className="rq-titles-chase__row">
                <span className="rq-titles-chase__name">{chase.title}</span>
                <span className="rq-titles-chase__gap">{chase.gap}</span>
              </span>
              <span className="rq-titles-chase__who">{chase.who}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="rq-titles-side__foot">Titles change hands when someone beats the holder's number.</p>
    </section>
  );
}
