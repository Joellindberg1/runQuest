import type { Dispatch, SetStateAction } from 'react';
import { ErrorState } from '@/shared/components/ErrorState';
import { FormNotices } from '@/shared/components/form/FormNotices';
import { TextField } from '@/shared/components/form/TextField';
import { RQIcon } from '@/shared/components/icons';
import { TrackLoader } from '@/shared/components/loaders/TrackLoader';
import { MULTIPLIER_MAX, MULTIPLIER_MIN, XP_GROUPS, fieldValue, multiplierRows, parseField, type XpFieldDef } from '../adminModel';
import type { AdminNotice, AdminSettings } from '../hooks/useAdminData';

const LOADER_SIZE = 64;
const SAVE_HINT_ID = 'admin-save-hint';

interface XpSettingsPanelProps {
  settings: AdminSettings;
  setSettings: Dispatch<SetStateAction<AdminSettings>>;
  /** Falskt tills inställningarna OCH trappan lästs in — Save är då låst (annars skrivs prod över med standardvärden). */
  canSave: boolean;
  loadFailed: boolean;
  onReload: () => void;
  newMultiplierDay: string;
  setNewMultiplierDay: (value: string) => void;
  newMultiplierValue: string;
  setNewMultiplierValue: (value: string) => void;
  onAddMultiplier: () => void;
  onSave: () => void;
  notice: AdminNotice | undefined;
}

function FieldRow({ field, settings, setSettings }: { field: XpFieldDef } & Pick<XpSettingsPanelProps, 'settings' | 'setSettings'>) {
  const id = `admin-${field.key}`;
  const value = settings[field.key];
  const common = { id, className: 'rq-field rq-field--mono rq-admin-row__input' };
  return (
    <li className="rq-admin-row">
      <label htmlFor={id} className="rq-admin-row__label">{field.label}</label>
      {field.kind === 'date' ? (
        <input {...common} type="date" value={String(value)} readOnly aria-readonly="true" />
      ) : (
        <input
          {...common}
          type="number"
          inputMode={field.kind === 'int' ? 'numeric' : 'decimal'}
          step={field.kind === 'int' ? 1 : 0.1}
          min={0}
          value={fieldValue(Number(value))}
          readOnly={!field.editable}
          aria-readonly={field.editable ? undefined : true}
          onChange={(event) => {
            const parsed = parseField(event.target.value, field.kind as 'int' | 'decimal');
            setSettings((previous) => ({ ...previous, [field.key]: parsed }));
          }}
        />
      )}
    </li>
  );
}

/**
 * XP-inställningarna som tre kort (Basic XP · Distance bonuses · Streak multipliers) och EN guldknapp. Save är låst tills
 * både inställningarna och trappan lästs in (`canSave`); misslyckas inläsningen visas ett felkort med Retry — fälten får
 * aldrig visa standardvärden som om de vore de riktiga. Servern validerar (multiplikator 1–9.99, högst två decimaler) och
 * dess skäl visas i alert-regionen.
 */
export function XpSettingsPanel({
  settings, setSettings, canSave, loadFailed, onReload,
  newMultiplierDay, setNewMultiplierDay, newMultiplierValue, setNewMultiplierValue, onAddMultiplier, onSave, notice,
}: XpSettingsPanelProps) {
  const rows = multiplierRows(settings.multipliers);

  let body;
  if (canSave) {
    body = (
      <div className="rq-admin-groups">
        {XP_GROUPS.map((group) => (
          <section key={group.id} className="rq-card rq-card--edge rq-admin-group" aria-labelledby={`admin-group-${group.id}`}>
            <h2 id={`admin-group-${group.id}`} className="rq-title rq-admin-group__title">{group.title}</h2>
            <p className="rq-admin-group__note">{group.note}</p>
            <ul className="rq-admin-rows">
              {group.fields.map((field) => (
                <FieldRow key={field.key} field={field} settings={settings} setSettings={setSettings} />
              ))}
            </ul>
            {group.id === 'basic' && (
              <p className="rq-admin-group__aside">Streak minimum and run date are fixed in the app for now — they are shown, not saved.</p>
            )}
          </section>
        ))}

        <section className="rq-card rq-card--edge rq-admin-group" aria-labelledby="admin-group-streak">
          <h2 id="admin-group-streak" className="rq-title rq-admin-group__title">Streak multipliers</h2>
          <p className="rq-admin-group__note">Consecutive days with a qualifying run</p>
          <ul className="rq-admin-rows">
            {rows.map((row) => {
              const id = `admin-multiplier-${row.days}`;
              return (
                <li key={row.days} className="rq-admin-row">
                  <label htmlFor={id} className="rq-admin-row__label">{row.label}</label>
                  <input
                    id={id}
                    type="number"
                    inputMode="decimal"
                    className="rq-field rq-field--mono rq-admin-row__input"
                    step={0.01}
                    min={MULTIPLIER_MIN}
                    max={MULTIPLIER_MAX}
                    value={fieldValue(row.multiplier)}
                    aria-invalid={!(row.multiplier >= MULTIPLIER_MIN && row.multiplier <= MULTIPLIER_MAX) || undefined}
                    onChange={(event) => {
                      const parsed = parseField(event.target.value, 'decimal');
                      setSettings((previous) => ({ ...previous, multipliers: { ...previous.multipliers, [row.days]: parsed } }));
                    }}
                  />
                </li>
              );
            })}
          </ul>
          <div className="rq-admin-add-step" role="group" aria-label="Add a streak step">
            <TextField id="admin-new-days" label="Days" hideLabel inputMode="numeric" placeholder="Days" value={newMultiplierDay} onChange={(event) => setNewMultiplierDay(event.target.value)} />
            <TextField id="admin-new-multiplier" label="Multiplier" hideLabel inputMode="decimal" placeholder="Multiplier" value={newMultiplierValue} onChange={(event) => setNewMultiplierValue(event.target.value)} />
            <button type="button" className="rq-btn rq-btn--secondary rq-btn--icon" onClick={onAddMultiplier} aria-label="Add streak step">
              <RQIcon name="plus" size={17} />
            </button>
          </div>
        </section>
      </div>
    );
  } else if (loadFailed) {
    body = (
      <ErrorState
        title="Couldn't load the XP settings"
        message="Nothing was changed — saving stays locked until the current settings have loaded. Try again in a moment."
        onRetry={onReload}
      />
    );
  } else {
    body = (
      <section className="rq-card rq-admin-pending">
        <TrackLoader size={LOADER_SIZE} label="Loading the XP settings" />
      </section>
    );
  }

  return (
    <div className="rq-admin-xp">
      {body}
      <div className="rq-admin-save">
        <button type="button" className="rq-btn rq-btn--primary rq-btn--lg" onClick={onSave} disabled={!canSave} aria-describedby={canSave ? undefined : SAVE_HINT_ID}>
          Save all settings
        </button>
        {!canSave && (
          <p id={SAVE_HINT_ID} className="rq-admin-save__hint">
            Saving unlocks once the current settings have loaded.
          </p>
        )}
      </div>
      <FormNotices name="Settings" status={notice?.status} error={notice?.error} />
    </div>
  );
}
