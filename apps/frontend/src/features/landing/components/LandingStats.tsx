import { usePublicStats } from '../hooks/usePublicStats';
import { buildStatViews } from '../landingModel';

/**
 * Sifferraden: km (guld), löpare, utmaningar ur GET /public/stats. Inga uppräkningar och inga reservsiffror: medan svaret laddas står
 * ett tankstreck i talens storlek (aria-busy). Raden har samma höjd och breda tal reserverar sin plats i CSS, så att talen som anländer inte
 * flyttar något. Vid fel står raden kvar som en tom, osynlig remsa (aria-hidden + visibility: hidden i CSS, ägarbeslut B i ADR 006-addendum
 * 2026-10-19): förrenderingen har redan målat raden, och en borttagen rad skulle skjuta allt under den uppåt.
 * Varje tal är en listpost ("4 551 km logged") som läses som en enhet; ingen live-region.
 */
export function LandingStats() {
  const stats = usePublicStats();

  return (
    <section
      className="rq-landing-stats"
      aria-labelledby="landing-stats-title"
      aria-busy={stats.isPending ? 'true' : undefined}
      aria-hidden={stats.isError ? 'true' : undefined}
    >
      <h2 id="landing-stats-title" className="sr-only">RunQuest in numbers</h2>
      <ul className="rq-landing-stats__list">
        {buildStatViews(stats.data).map((stat) => (
          <li key={stat.key} className="rq-landing-stat" data-stat={stat.key} data-tone={stat.tone}>
            <span className="rq-landing-stat__value">{stat.value}</span>
            {' '}
            <span className="rq-landing-stat__label">{stat.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
