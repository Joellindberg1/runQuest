import { useMemo } from 'react';
import { useNow } from '@/app-shell/useNow';
import { useAuth } from '@/providers/authContext';
import { STRAVA_RUN_TYPES_LABEL } from '@/features/playbook/playbookFacts';
import { ErrorState } from '@/shared/components/ErrorState';
import { TrackLoader } from '@/shared/components/loaders/TrackLoader';
import { useStravaActions } from '../hooks/useStravaActions';
import { useStravaData } from '../hooks/useStravaData';
import '../settings.css';
import { buildStravaCard, buildSyncRow } from '../settingsModel';
import { NotificationSettingsPanel } from './NotificationSettingsPanel';
import { PasswordCard } from './PasswordCard';
import { StravaCard } from './StravaCard';
import { SyncCard } from './SyncCard';

const LOADER_SIZE = 64;
/** Ägaren har "Sync now" (som tidigare); för andra är den automatiska synken allt som behövs. */
const SYNC_NOW_USER = 'Joel Lindberg';

/**
 * /settings: Strava-koppling, notisinställningar, lösenordsbyte och senaste synk. Web Prototypens Settings; mobilprototypen saknar sidan,
 * så mobil är härledd (en kolumn). Notiskortet ligger mellan Strava och lösenordet och laddar sina inställningar själv: ett fel där stoppar
 * inte de andra korten.
 */
export function SettingsScreen() {
  const { user } = useAuth();
  const now = useNow();
  const { status, sync, config } = useStravaData();

  // Kortet väntar in synkinformationen (parallell hämtning): annars blinkar cellerna "Unknown" innan de får sitt värde.
  const card = useMemo(() => (status.data && !sync.isPending ? buildStravaCard(status.data, sync.data, now) : null), [status.data, sync.data, sync.isPending, now]);
  const syncRow = useMemo(() => buildSyncRow(sync.data), [sync.data]);
  const actions = useStravaActions({ clientId: config.data });

  let strava;
  if (card) {
    strava = (
      <StravaCard
        view={card}
        canSyncNow={user?.name === SYNC_NOW_USER}
        syncing={actions.syncing}
        status={actions.status}
        error={actions.error}
        onConnect={(agreed) => void actions.connect(agreed)}
        onSync={() => void actions.sync()}
      />
    );
  } else if (status.isError) {
    strava = (
      <ErrorState
        title="Couldn't load Strava"
        message="Your connection is safe — we just could not read its status. Try again in a moment."
        retrying={status.isFetching}
        onRetry={() => void status.refetch()}
      />
    );
  } else {
    strava = (
      <section className="rq-card rq-settings-pending">
        <TrackLoader size={LOADER_SIZE} label="Loading Strava" />
      </section>
    );
  }

  return (
    <div className="rq-settings">
      <header className="rq-settings__head">
        <h1 className="rq-display rq-settings__title">Settings</h1>
        <p className="rq-settings__sub">Strava, notifications and password</p>
      </header>
      <div className="rq-settings__split">
        <div className="rq-settings__main">
          {strava}
          <NotificationSettingsPanel className="rq-card rq-card--edge rq-settings-card" />
          <PasswordCard />
        </div>
        <div className="rq-settings__side">
          <SyncCard row={syncRow} failed={sync.isError && !sync.data} loading={sync.isPending} />
          <p className="rq-settings-note">
            Running activities ({STRAVA_RUN_TYPES_LABEL}) are imported, treadmill runs included, and duplicates are filtered.
          </p>
        </div>
      </div>
    </div>
  );
}
