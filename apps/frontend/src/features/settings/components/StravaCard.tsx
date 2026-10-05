import { FormNotices } from '@/shared/components/form/FormNotices';
import { RQIcon } from '@/shared/components/icons';
import type { StravaCardView } from '../settingsModel';

const ICON_SIZE = 15;

interface StravaCardProps {
  view: StravaCardView;
  /** "Sync now" är ett verktyg för ägaren — övriga ser ingen knapp (som tidigare). */
  canSyncNow: boolean;
  syncing: boolean;
  status: string | null;
  error: string | null;
  onConnect: () => void;
  onSync: () => void;
}

const CONNECT_LABEL = { disconnected: 'Connect Strava', expired: 'Reconnect Strava' } as const;

/**
 * Strava-kortet: tillståndet som kantfärg (grön lever · röd utgången · neutral inte kopplad) och statuschip, tre celler
 * (Connected · Last sync · Next sync), vad som importeras och åtgärderna. Alla knappar är sekundära — Settings guldknapp
 * är "Change password".
 */
export function StravaCard({ view, canSyncNow, syncing, status, error, onConnect, onSync }: StravaCardProps) {
  return (
    <section className="rq-card rq-card--edge rq-settings-card" data-tone={view.tone} aria-labelledby="settings-strava-title">
      <div className="rq-settings-card__head">
        <div className="rq-settings-card__intro">
          <h2 id="settings-strava-title" className="rq-heading rq-settings-card__title">Strava</h2>
          <p className="rq-settings-card__lead">{view.lead}</p>
        </div>
        <p className={view.tone === 'muted' ? 'rq-chip' : `rq-chip rq-chip--status rq-chip--${view.tone}`}>
          {view.state === 'connected' && <span className="rq-dot rq-dot--live" aria-hidden="true" />}
          {view.chip}
        </p>
      </div>

      {view.meta.length > 0 && (
        <dl className="rq-hairgrid rq-hairgrid--framed rq-settings-meta">
          {view.meta.map((cell) => (
            <div key={cell.key} className="rq-cell rq-settings-meta__cell">
              <dt className="rq-settings-meta__label">{cell.label}</dt>
              <dd className="rq-settings-meta__value" data-tone={cell.tone}>{cell.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {view.rules.length > 0 && (
        <ul className="rq-settings-rules" aria-label="What gets imported">
          {view.rules.map((rule) => (
            <li key={rule} className="rq-settings-rule">
              <span className="rq-dot rq-settings-rule__dot" aria-hidden="true" />
              {rule}
            </li>
          ))}
        </ul>
      )}

      {view.renewal && (
        <p className="rq-settings-renewal" data-tone={view.renewal.tone}>
          {view.renewal.text}
        </p>
      )}

      <div className="rq-settings-actions">
        {view.state !== 'connected' && (
          <button type="button" className="rq-btn rq-btn--secondary" onClick={onConnect}>
            {CONNECT_LABEL[view.state]}
          </button>
        )}
        {view.state === 'connected' && canSyncNow && (
          <>
            <button type="button" className="rq-btn rq-btn--secondary" onClick={onSync} disabled={syncing}>
              <RQIcon name="sync" size={ICON_SIZE} />
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
            <p className="rq-settings-actions__hint">Your data syncs automatically — this is only for impatient moments.</p>
          </>
        )}
      </div>

      <FormNotices name="Strava" status={status} error={error} />
    </section>
  );
}
