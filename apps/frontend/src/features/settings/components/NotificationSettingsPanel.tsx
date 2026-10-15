import { useId, useMemo, useRef, useState } from 'react';
import { NOTIFICATION_GROUPS, NOTIFICATION_KINDS, type NotificationGroup, type NotificationRole } from '@runquest/shared';
import { RQIcon } from '@/shared/components/icons';
import { Switch } from '@/shared/components/form/Switch';
import { useUserSettings } from '../hooks/useUserSettings';
import '../settings.css';

const ICON_SIZE = 15;
const LEAD = 'Everything still lands in Pack News — this decides what reaches you.';
const SAVE_FAILED = 'Couldn’t save that change. It is back to how it was. Try again.';
const OFF_BY_DEFAULT = 'Off by default';

/** Det panelen läser ur registret (NOTIFICATION_KINDS uppfyller formen). */
export interface PanelKind {
  key: string;
  label: string;
  group: NotificationGroup;
  role: NotificationRole;
  default: boolean;
}

/** Titeln på h2 eller h3; sektionerna ligger en nivå under (h3 eller h4), så det finns inget h5. */
type HeadingLevel = 2 | 3;
type SectionHeadingLevel = 3 | 4;

export interface NotificationSettingsPanelProps {
  /** Nivån på panelens titel; sektionsrubrikerna ligger en nivå under. Panelen vet inget om sidan runt den. */
  headingLevel?: HeadingLevel;
  /** Om sektionerna börjar uppfällda. Settings fäller upp alla; smala ytor börjar hopfällda. */
  defaultExpanded?: boolean;
  /** Kortets ram (t.ex. `rq-card rq-card--edge`) kommer från den som monterar panelen. */
  className?: string;
  /** Totalsumman ("16 of 19 on") i huvudet. Smala ytor (bladet och sidokolumnen på /news) tar bort den; sektionernas räknare och "Defaults shown" står kvar. */
  showTotal?: boolean;
  /** Vart fokus går efter Retry. Standard är panelens egen titel; en värd som döljer den (bladet på /news) pekar på sin synliga rubrik. */
  retryFocus?: () => HTMLElement | null;
  /** Slagen att visa. Standard är hela registret; en annan lista är till för tester. */
  kinds?: readonly PanelKind[];
}

interface Section {
  name: NotificationGroup;
  kinds: PanelKind[];
}

/** Sektionerna i registrets ordning. En sektion utan slag finns inte (ADR 011 beslut 1.3: inga reglage utan fakta bakom). */
function buildSections(kinds: readonly PanelKind[]): Section[] {
  return NOTIFICATION_GROUPS.map((name) => ({ name, kinds: kinds.filter((kind) => kind.group === name) })).filter((section) => section.kinds.length > 0);
}

const isOn = (kind: PanelKind, values: Record<string, unknown>) => (typeof values[kind.key] === 'boolean' ? values[kind.key] === true : kind.default);

interface NotificationSectionProps {
  section: Section;
  values: Record<string, unknown>;
  disabled: boolean;
  defaultExpanded: boolean;
  level: SectionHeadingLevel;
  onToggle: (key: string) => void;
}

function NotificationSection({ section, values, disabled, defaultExpanded, level, onToggle }: NotificationSectionProps) {
  const [open, setOpen] = useState(defaultExpanded);
  const id = useId();
  const nameId = `${id}-name`;
  const listId = `${id}-list`;
  const Heading = `h${level}` as const;
  const on = section.kinds.filter((kind) => isOn(kind, values)).length;

  return (
    <div role="group" aria-labelledby={nameId} className="rq-notify-section">
      <Heading className="rq-notify-section__title">
        <button type="button" className="rq-notify-section__toggle" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((previous) => !previous)}>
          <span id={nameId} className="rq-notify-section__name">
            {section.name}
          </span>
          <span className="rq-notify-section__meta">
            {on} of {section.kinds.length} on
            <span className="rq-notify-section__chev" aria-hidden="true">
              <RQIcon name="chevron" size={ICON_SIZE} />
            </span>
          </span>
        </button>
      </Heading>
      <ul id={listId} hidden={!open} className="rq-hairgrid rq-hairgrid--framed rq-notify-list">
        {section.kinds.map((kind) => (
          <li key={kind.key} className="rq-cell">
            <Switch
              label={kind.label}
              note={kind.default ? undefined : OFF_BY_DEFAULT}
              quiet={kind.role === 'others'}
              checked={isOn(kind, values)}
              disabled={disabled}
              onCheckedChange={() => onToggle(kind.key)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Skelettet har sektionernas och radernas form (ur registret), så kortet inte hoppar när värdena kommer. */
function NotificationSkeleton({ sections }: { sections: Section[] }) {
  return (
    <div className="rq-notify-skel" aria-hidden="true">
      {sections.map((section) => (
        <div key={section.name} className="rq-notify-skel__group">
          <div className="rq-skel-block rq-notify-skel__title" />
          {section.kinds.map((kind) => (
            <div key={kind.key} className="rq-notify-skel__row">
              <div className="rq-skel-block rq-notify-skel__label" />
              <div className="rq-skel-block rq-notify-skel__switch" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Notisinställningarna (ADR 011 beslut 9): ett reglage per slag i registret, grupperade per sektion. EN komponent för båda
 * platserna där den bor (Settings och /news), så den antar ingen route eller layout runt sig.
 *
 * - **Optimistiskt:** reglaget byter läge direkt (useUserSettings); ett fel återställer det och står i den enda `role="alert"`-regionen.
 *   Den enda `role="status"`-regionen säger "Loading…" / "Saving…"; inget annat annonseras per reglage.
 * - **Laddningsfel (inget data alls, `loadFailed`):** standardvärdena visas, tydligt märkta, med Retry. Reglagen är låsta (`aria-disabled`): en skrivning ovanpå sparade
 *   val som inte gick att läsa vore en gissning.
 * - **Reset to defaults** syns bara när något är anpassat och skickar null för varje anpassad nyckel.
 */
export function NotificationSettingsPanel({ headingLevel = 2, defaultExpanded = true, className, showTotal = true, retryFocus, kinds = NOTIFICATION_KINDS }: NotificationSettingsPanelProps) {
  const settings = useUserSettings();
  const titleId = useId();
  const sections = useMemo(() => buildSections(kinds), [kinds]);
  const Title = `h${headingLevel}` as const;
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Retry avmonteras av laddningsläget; fokus flyttas till titeln så att det inte hamnar på body.
  const retry = () => {
    (retryFocus?.() ?? titleRef.current)?.focus();
    settings.reload();
  };
  const sectionLevel: SectionHeadingLevel = headingLevel === 2 ? 3 : 4;

  const shown = sections.flatMap((section) => section.kinds);
  const onCount = shown.filter((kind) => isOn(kind, settings.values)).length;
  let count = showTotal ? `${onCount} of ${shown.length} on` : '';
  if (settings.isLoading) count = '';
  else if (settings.loadFailed) count = 'Defaults shown';

  let status = '';
  if (settings.isLoading) status = 'Loading…';
  else if (settings.isSaving) status = 'Saving…';

  return (
    <section className={className ? `rq-notify ${className}` : 'rq-notify'} aria-labelledby={titleId}>
      <header className="rq-notify__head">
        <Title id={titleId} ref={titleRef} tabIndex={-1} className="rq-heading rq-notify__title">
          Notifications
        </Title>
        <div className="rq-notify__meta">
          <p role="status" aria-label="Notification settings status" className="rq-notify__status">
            {status}
          </p>
          <p className="rq-notify__count" data-tone={settings.loadFailed ? 'defaults' : undefined}>
            {count}
          </p>
        </div>
      </header>
      <p className="rq-notify__lead">{LEAD}</p>

      <div role="alert" aria-label="Notification settings error" className="rq-notify__alerts">
        {settings.error && (
          <p className="rq-form-notice" data-tone="error">
            {SAVE_FAILED}
          </p>
        )}
        {settings.loadFailed && (
          <p className="rq-form-notice" data-tone="error">
            <strong>Couldn’t load your notification settings.</strong> Your saved choices are safe; showing the defaults until we can read them.{' '}
            <button type="button" className="rq-btn rq-btn--link rq-notify__link" onClick={retry}>
              Retry
            </button>
          </p>
        )}
      </div>

      {settings.isLoading ? (
        <NotificationSkeleton sections={sections} />
      ) : (
        <div className="rq-notify__sections">
          {sections.map((section) => (
            <NotificationSection
              key={section.name}
              section={section}
              values={settings.values}
              disabled={settings.loadFailed}
              defaultExpanded={defaultExpanded}
              level={sectionLevel}
              onToggle={settings.toggle}
            />
          ))}
        </div>
      )}

      {settings.customised.length > 0 && (
        <div className="rq-notify__foot">
          <button type="button" className="rq-btn rq-btn--link rq-notify__link" onClick={() => settings.reset(settings.customised)}>
            Reset to defaults
          </button>
        </div>
      )}
    </section>
  );
}
