import { useState, type FormEvent } from 'react';
import { FormNotices } from '@/shared/components/form/FormNotices';
import { TextField } from '@/shared/components/form/TextField';
import { RQIcon } from '@/shared/components/icons';
import { backendApi } from '@/shared/services/backendApi';
import type { AdminNotice } from '../hooks/useAdminData';

interface BackfillResult {
  totalUpdated: number;
  summary: Array<{ user: string; updated: number; error?: string }>;
}

interface SecurityPanelProps {
  newAdminPassword: string;
  setNewAdminPassword: (password: string) => void;
  onChangeAdminPassword: () => void;
  notice: AdminNotice | undefined;
}

/** Säkerhet: adminlösenordet (ännu inte kopplat till backend — som tidigare) och Strava-backfillen av utökad data. */
export function SecurityPanel({ newAdminPassword, setNewAdminPassword, onChangeAdminPassword, notice }: SecurityPanelProps) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BackfillResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runBackfill = async () => {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await backendApi.backfillStravaExtendedData();
      if (res.success && res.data) setResult(res.data);
      else setError(res.error || 'The backfill did not finish. Runs that were already updated stay updated.');
    } catch {
      setError('The backfill did not finish. Runs that were already updated stay updated.');
    } finally {
      setRunning(false);
    }
  };

  const onPassword = (event: FormEvent) => {
    event.preventDefault();
    onChangeAdminPassword();
  };

  return (
    <div className="rq-admin-security">
      <form className="rq-card rq-card--edge rq-form rq-admin-card" noValidate onSubmit={onPassword} aria-labelledby="admin-password-title">
        <h2 id="admin-password-title" className="rq-title rq-admin-card__title">Admin password</h2>
        <TextField
          id="admin-new-admin-password"
          label="New admin password"
          type="password"
          autoComplete="new-password"
          placeholder="Enter new password"
          value={newAdminPassword}
          onChange={(event) => setNewAdminPassword(event.target.value)}
        />
        <div className="rq-admin-actions">
          <button type="submit" className="rq-btn rq-btn--primary">Change password</button>
        </div>
        <FormNotices name="Admin password" status={notice?.status} error={notice?.error} />
      </form>

      <section className="rq-card rq-card--edge rq-admin-card" aria-labelledby="admin-backfill-title">
        <h2 id="admin-backfill-title" className="rq-title rq-admin-card__title">Strava extended data</h2>
        <p className="rq-admin-card__note">
          Re-fetches all historical Strava activities and fills in the extended fields (pace, elevation, heart rate, suffer score, GPS) for existing runs.
        </p>
        <div className="rq-admin-actions">
          <button type="button" className="rq-btn rq-btn--secondary" onClick={() => void runBackfill()} disabled={running}>
            <RQIcon name="sync" size={15} />
            {running ? 'Running backfill…' : 'Run backfill'}
          </button>
        </div>
        <div role="status" aria-label="Backfill result">
          {result && (
            <div className="rq-admin-backfill">
              <p className="rq-admin-backfill__total">Total updated: {result.totalUpdated} runs</p>
              <ul className="rq-hairgrid rq-admin-backfill__rows">
                {result.summary.map((entry) => (
                  <li key={entry.user} className="rq-admin-backfill__row" data-tone={entry.error ? 'down' : undefined}>
                    <span>{entry.user}</span>
                    <span>{entry.error ?? `${entry.updated} runs`}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <FormNotices name="Backfill" error={error} />
      </section>
    </div>
  );
}
