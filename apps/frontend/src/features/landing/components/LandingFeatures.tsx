import { useMemo } from 'react';
import { FEATURES_ID, buildFeatures } from '../landingModel';

/** Sex kort om vad som finns i spelet. Rubriken är gömd (korten bär budskapet); varje kort har en h3. */
export function LandingFeatures() {
  const cards = useMemo(() => buildFeatures(), []);

  return (
    <section id={FEATURES_ID} className="rq-landing-features" aria-labelledby="landing-features-title">
      <h2 id="landing-features-title" className="sr-only">What's in the game</h2>
      <ul className="rq-landing-features__list">
        {cards.map((card) => (
          <li key={card.tag} className="rq-landing-feature">
            <span className="rq-landing-feature__tag" aria-hidden="true">{card.tag}</span>
            <div>
              <h3 className="rq-name rq-landing-feature__title">{card.title}</h3>
              <p className="rq-body rq-landing-feature__body">{card.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
