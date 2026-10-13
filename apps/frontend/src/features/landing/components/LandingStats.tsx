import { usePublicStats } from '../hooks/usePublicStats';
import { buildStatViews } from '../landingModel';

/**
 * Sifferraden: km (guld), löpare, utmaningar ur GET /public/stats. Inga uppräkningar och inga reservsiffror: medan svaret laddas står
 * ett tankstreck i talens storlek (aria-busy), och vid fel döljs hela raden utan meddelande — resten av sidan berörs inte.
 * Varje tal är en listpost ("4 551 km logged") som läses som en enhet; ingen live-region.
 */
export function LandingStats() {
  const stats = usePublicStats();
  if (stats.isError) return null;

  return (
    <section className="rq-landing-stats" aria-labelledby="landing-stats-title" aria-busy={stats.isPending ? 'true' : undefined}>
      <h2 id="landing-stats-title" className="sr-only">RunQuest in numbers</h2>
      <ul className="rq-landing-stats__list">
        {buildStatViews(stats.data).map((stat) => (
          <li key={stat.key} className="rq-landing-stat" data-tone={stat.tone}>
            <span className="rq-landing-stat__value">{stat.value}</span>
            {' '}
            <span className="rq-landing-stat__label">{stat.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
