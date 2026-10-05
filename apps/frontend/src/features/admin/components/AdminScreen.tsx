import { ViewTabs, type ViewTab } from '@/shared/components/ViewTabs';
import { panelId, tabId } from '@/shared/components/viewTabIds';
import { useViewParam } from '@/shared/hooks/useViewParam';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { ADMIN_VIEWS, DEFAULT_ADMIN_VIEW, type AdminView } from '../adminModel';
import { useAdminData } from '../hooks/useAdminData';
import '../admin.css';
import { MembersPanel } from './MembersPanel';
import { SecurityPanel } from './SecurityPanel';
import { TitlesPanel } from './TitlesPanel';
import { XpSettingsPanel } from './XpSettingsPanel';

const ID_PREFIX = 'admin';

const TABS: readonly ViewTab<AdminView>[] = [
  { key: 'xp', label: 'XP settings' },
  { key: 'users', label: 'Users' },
  { key: 'titles', label: 'Titles' },
  { key: 'security', label: 'Security' },
];

/**
 * /admin: XP-inställningar, medlemmar, titlar och säkerhet (`?view=xp|users|titles|security`). Web Prototypens Admin;
 * mobilprototypen saknar sidan, så mobil är härledd (en kolumn, flikarna under rubriken). All data bor i `useAdminData` här,
 * så det man skrivit överlever ett flikbyte. Admin ersätts senare av XP-paket — den här skärmen är bara designen.
 */
export function AdminScreen() {
  const isDesktop = useIsDesktop();
  const admin = useAdminData();
  const [view, setView] = useViewParam(ADMIN_VIEWS, DEFAULT_ADMIN_VIEW);

  if (isDesktop === undefined) return null;

  const tabs = <ViewTabs label="Admin view" tabs={TABS} value={view} onChange={setView} idPrefix={ID_PREFIX} className="rq-admin__tabs" />;

  return (
    <div className="rq-admin">
      <header className="rq-admin__head">
        <div>
          <h1 className="rq-display rq-admin__title">Admin</h1>
          <p className="rq-admin__sub">{isDesktop ? 'XP rules, members and titles · changes apply to the whole pack' : 'Changes apply to the whole pack'}</p>
        </div>
        {isDesktop && tabs}
      </header>
      {!isDesktop && tabs}

      <div key={view} role="tabpanel" id={panelId(ID_PREFIX)} aria-labelledby={tabId(ID_PREFIX, view)} className="rq-admin__panel rq-rise">
        {view === 'xp' && (
          <XpSettingsPanel
            settings={admin.settings}
            setSettings={admin.setSettings}
            canSave={admin.settingsLoaded}
            loadFailed={admin.settingsError}
            onReload={() => void admin.reloadSettings()}
            newMultiplierDay={admin.newMultiplierDay}
            setNewMultiplierDay={admin.setNewMultiplierDay}
            newMultiplierValue={admin.newMultiplierValue}
            setNewMultiplierValue={admin.setNewMultiplierValue}
            onAddMultiplier={admin.handleAddMultiplier}
            onSave={() => void admin.handleSaveSettings()}
            notice={admin.notices.settings}
          />
        )}
        {view === 'users' && (
          <MembersPanel
            users={admin.users}
            loading={admin.loadingUsers}
            loadFailed={admin.usersError}
            onRetry={() => void admin.fetchUsers()}
            newUser={admin.newUser}
            setNewUser={admin.setNewUser}
            editingUser={admin.editingUser}
            setEditingUser={admin.setEditingUser}
            newPasswordForUser={admin.newPasswordForUser}
            setNewPasswordForUser={admin.setNewPasswordForUser}
            onAddUser={() => void admin.handleAddUser()}
            onResetUserPassword={(userId) => void admin.handleResetUserPassword(userId)}
            notice={admin.notices.users}
          />
        )}
        {view === 'titles' && <TitlesPanel />}
        {view === 'security' && (
          <SecurityPanel
            newAdminPassword={admin.newAdminPassword}
            setNewAdminPassword={admin.setNewAdminPassword}
            onChangeAdminPassword={admin.handleChangeAdminPassword}
            notice={admin.notices.security}
          />
        )}
      </div>
    </div>
  );
}
