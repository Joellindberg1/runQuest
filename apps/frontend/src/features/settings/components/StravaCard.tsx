import { useRef, useState } from 'react';
import { FormNotices } from '@/shared/components/form/FormNotices';
import { RQIcon } from '@/shared/components/icons';
import type { ConnectionAction } from '../hooks/useStravaActions';
import { isLiveConnection, type StravaCardView } from '../settingsModel';
import { StravaConnectionDialog, type ConnectionStep } from './StravaConnectionDialog';
import { StravaConsentBlock, StravaConsentInfo } from './StravaConsentBlock';

const ICON_SIZE = 15;

/** Pausa, slå på och koppla bort. Varje åtgärd svarar om den lyckades; kortet stänger dialogen och flyttar fokus först då. */
export interface StravaConnectionControls {
  /** Antalet Stravarundor appen känner till; `null` så länge rundorna inte är lästa (då visar bekräftelsen ingen siffra). */
  stravaRuns: number | null;
  busy: ConnectionAction | null;
  /** Dialogens fel (pause/disconnect) — visas i dialogen, aldrig i kortet bakom den. */
  error: string | null;
  onPause: () => Promise<boolean>;
  onResume: () => Promise<boolean>;
  onDisconnect: () => Promise<boolean>;
  onClearError: () => void;
}

interface StravaCardProps {
  view: StravaCardView;
  /** "Sync now" är ett verktyg för ägaren — övriga ser ingen knapp (som tidigare). */
  canSyncNow: boolean;
  syncing: boolean;
  status: string | null;
  error: string | null;
  connection: StravaConnectionControls;
  /** Anropas med rutans läge; knappen är dessutom låst utan bock, och kopplingen görs aldrig utan bock. */
  onConnect: (agreed: boolean) => void;
  onSync: () => void;
}

const CONNECT_LABEL = { disconnected: 'Connect Strava', expired: 'Reconnect Strava' } as const;

/** Vart fokus går när dialogen stängs: tillbaka till knappen som öppnade den, till rubriken efter en lyckad åtgärd, eller ingenstans (steget byts bara). */
type FocusTarget = 'opener' | 'heading' | 'none';

/**
 * Strava-kortet: tillståndet som kantfärg (grön lever · neutral pausad · röd utgången · neutral inte kopplad) och statuschip, tre celler
 * (Connected · Last sync), vad som importeras, samtycket och åtgärderna. Alla knappar är sekundära — Settings guldknapp är
 * "Change password". Utan koppling (och vid utgången koppling) låser samtyckesrutan upp knappen; den som är ansluten ser samma text som
 * information, ovanför åtgärderna.
 *
 * Åtgärderna (ADR 010 beslut 7.6): medan synken kör öppnar "Pause or disconnect" en dialog med två val; ett pausat kort har två knappar,
 * "Turn sync back on" och "Disconnect", där Disconnect går rakt till bekräftelsen. Rubriken har tabindex=-1 och tar emot fokus efter en lyckad
 * åtgärd (knappen som hade fokus finns inte längre), och statusregionen ligger kvar i kortet så att bekräftelsen läses även när dialogen stängts.
 */
export function StravaCard({ view, canSyncNow, syncing, status, error, connection, onConnect, onSync }: StravaCardProps) {
  // Bocken nollas när tillståndet byter: efter en senare bortkoppling (eller en koppling som löpt ut) börjar rutan om som obockad.
  const [agreed, setAgreed] = useState(false);
  const [seenState, setSeenState] = useState(view.state);
  if (seenState !== view.state) { setSeenState(view.state); setAgreed(false); }

  const [step, setStep] = useState<ConnectionStep>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const focusAfterClose = useRef<FocusTarget>('opener');

  const live = isLiveConnection(view.state);
  const paused = view.state === 'paused';
  const busy = connection.busy !== null;

  const open = (next: Exclude<ConnectionStep, null>, opener: HTMLButtonElement) => {
    openerRef.current = opener;
    focusAfterClose.current = 'opener';
    connection.onClearError();
    setStep(next);
  };
  const cancel = () => {
    focusAfterClose.current = 'opener';
    connection.onClearError();
    setStep(null);
  };
  const chooseDisconnect = () => {
    // Valdialogen stängs utan att fokus återställs: bekräftelsen sätter sitt eget första fokus (Keep my connection).
    focusAfterClose.current = 'none';
    connection.onClearError();
    setStep('confirm');
  };
  const run = async (action: () => Promise<boolean>) => {
    if (!(await action())) return;
    focusAfterClose.current = 'heading';
    setStep(null);
    headingRef.current?.focus();
  };
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    if (focusAfterClose.current === 'opener') openerRef.current?.focus();
    else if (focusAfterClose.current === 'heading') headingRef.current?.focus();
  };

  return (
    <section className="rq-card rq-card--edge rq-settings-card" data-tone={view.tone} aria-labelledby="settings-strava-title">
      <div className="rq-settings-card__head">
        <div className="rq-settings-card__intro">
          <h2 ref={headingRef} id="settings-strava-title" tabIndex={-1} className="rq-heading rq-settings-card__title">Strava</h2>
          <p className="rq-settings-card__lead">{view.lead}</p>
        </div>
        <p className={view.tone === 'muted' ? 'rq-chip' : `rq-chip rq-chip--status rq-chip--${view.tone}`}>
          {view.state === 'connected' && <span className="rq-dot rq-dot--live" aria-hidden="true" />}
          {paused && <span className="rq-dot" aria-hidden="true" />}
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

      {view.note && <p className="rq-settings-renewal">{view.note}</p>}

      {view.renewal && (
        <p className="rq-settings-renewal" data-tone={view.renewal.tone}>
          {view.renewal.text}
        </p>
      )}

      {live ? <StravaConsentInfo /> : <StravaConsentBlock agreed={agreed} onAgreedChange={setAgreed} />}

      <div className="rq-settings-actions">
        {!live && (
          <button type="button" className="rq-btn rq-btn--secondary" onClick={() => onConnect(agreed)} disabled={!agreed}>
            {CONNECT_LABEL[view.state as keyof typeof CONNECT_LABEL]}
          </button>
        )}
        {view.state === 'connected' && canSyncNow && (
          <button type="button" className="rq-btn rq-btn--secondary" onClick={onSync} disabled={syncing}>
            <RQIcon name="sync" size={ICON_SIZE} />
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        )}
        {view.state === 'connected' && (
          <button type="button" className="rq-btn rq-btn--secondary" onClick={(event) => open('choose', event.currentTarget)}>
            Pause or disconnect
          </button>
        )}
        {paused && (
          <>
            <button type="button" className="rq-btn rq-btn--secondary" aria-disabled={busy || undefined} onClick={() => { if (!busy) void run(connection.onResume); }}>
              <RQIcon name="sync" size={ICON_SIZE} />
              {connection.busy === 'resume' ? 'Turning sync on…' : 'Turn sync back on'}
            </button>
            <button type="button" className="rq-btn rq-btn--secondary" aria-disabled={busy || undefined} onClick={(event) => { if (!busy) open('confirm', event.currentTarget); }}>
              Disconnect
            </button>
          </>
        )}
        {view.state === 'connected' && canSyncNow && <p className="rq-settings-actions__hint">Your data syncs automatically — this is only for impatient moments.</p>}
      </div>

      <FormNotices name="Strava" status={status} error={error} />

      <StravaConnectionDialog
        step={step}
        stravaRuns={connection.stravaRuns}
        busy={connection.busy}
        error={connection.error}
        onPause={() => void run(connection.onPause)}
        onChooseDisconnect={chooseDisconnect}
        onConfirmDisconnect={() => void run(connection.onDisconnect)}
        onCancel={cancel}
        onCloseAutoFocus={restoreFocus}
      />
    </section>
  );
}
