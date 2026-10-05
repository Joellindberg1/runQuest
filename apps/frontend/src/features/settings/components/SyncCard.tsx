import type { SyncRow } from '../settingsModel';

interface SyncCardProps {
  /** Synkinformationen hämtas fortfarande. */
  loading: boolean;
  row: SyncRow | null;
  /** Synkinformationen gick inte att läsa. Sidoinformation: en rad text, inget felkort. */
  failed: boolean;
}

/** "Latest sync": serverns senaste synk som en rad (klockslag · resultat). Backend har ingen historik, bara den senaste. */
export function SyncCard({ row, failed, loading }: SyncCardProps) {
  return (
    <section className="rq-card rq-settings-sync" aria-labelledby="settings-sync-title">
      <h2 id="settings-sync-title" className="rq-title rq-settings-sync__title">Latest sync</h2>
      {row ? (
        <p className="rq-settings-sync__row">
          <span className="rq-settings-sync__time">{row.time}</span>
          <span data-tone={row.tone}>{row.result}</span>
        </p>
      ) : (
        <p className="rq-settings-sync__empty">{loading ? 'Checking the latest sync…' : failed ? 'The sync status could not be read right now.' : 'No server sync yet.'}</p>
      )}
    </section>
  );
}
