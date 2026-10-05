import type { FormEvent } from 'react';
import { ErrorState } from '@/shared/components/ErrorState';
import { FormNotices } from '@/shared/components/form/FormNotices';
import { TextField } from '@/shared/components/form/TextField';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import type { AdminUser } from '@/shared/services/backendApi';
import { memberCountText, memberMeta } from '../adminModel';
import type { AdminNotice } from '../hooks/useAdminData';

const SKELETON_ROWS = 4;

interface NewUser {
  name: string;
  email: string;
  password: string;
}

interface MembersPanelProps {
  users: AdminUser[];
  loading: boolean;
  loadFailed: boolean;
  /** Läser om listan — Retry på felkortet och Refresh i rubriken. */
  onRetry: () => void;
  newUser: NewUser;
  setNewUser: (user: NewUser) => void;
  editingUser: AdminUser | null;
  setEditingUser: (user: AdminUser | null) => void;
  newPasswordForUser: string;
  setNewPasswordForUser: (password: string) => void;
  onAddUser: () => void;
  onResetUserPassword: (userId: string) => void;
  notice: AdminNotice | undefined;
}

/**
 * Medlemmarna som hårlinjegrid (namn · e-post · nivå/XP/rundor/streak · Reset password) och formuläret Add member med EN
 * guldknapp. Reset password öppnar ett lösenordsfält på raden; bekräftelser och fel står i regionerna under formuläret.
 */
export function MembersPanel({
  users, loading, loadFailed, onRetry, newUser, setNewUser, editingUser, setEditingUser,
  newPasswordForUser, setNewPasswordForUser, onAddUser, onResetUserPassword, notice,
}: MembersPanelProps) {
  const onAdd = (event: FormEvent) => {
    event.preventDefault();
    onAddUser();
  };

  let list;
  if (loading) {
    list = <SkeletonRows rows={SKELETON_ROWS} label="Loading members" />;
  } else if (loadFailed) {
    list = (
      <ErrorState
        title="Couldn't load the members"
        message="Nobody was removed or changed — we just could not read the list. Try again in a moment."
        onRetry={onRetry}
      />
    );
  } else if (users.length === 0) {
    list = <p className="rq-admin-empty">No members yet — add the first one below.</p>;
  } else {
    list = (
      <ul className="rq-hairgrid rq-admin-members" aria-label="Members">
        {users.map((user) => {
          const editing = editingUser?.id === user.id;
          return (
            <li key={user.id} className="rq-admin-member">
              <span className="rq-name rq-admin-member__name">{user.name}</span>
              <span className="rq-admin-member__email">{user.email}</span>
              <span className="rq-admin-member__meta">{memberMeta(user)}</span>
              {editing ? (
                <form
                  className="rq-admin-member__edit"
                  onSubmit={(event) => { event.preventDefault(); onResetUserPassword(user.id); }}
                >
                  <TextField
                    id={`admin-reset-${user.id}`}
                    label={`New password for ${user.name}`}
                    hideLabel
                    type="password"
                    autoComplete="new-password"
                    placeholder="New password"
                    value={newPasswordForUser}
                    onChange={(event) => setNewPasswordForUser(event.target.value)}
                    autoFocus
                  />
                  <button type="submit" className="rq-btn rq-btn--secondary rq-btn--compact">Save</button>
                  <button type="button" className="rq-btn rq-btn--ghost rq-btn--compact" onClick={() => { setEditingUser(null); setNewPasswordForUser(''); }}>
                    Cancel
                  </button>
                </form>
              ) : (
                <button type="button" className="rq-btn rq-btn--link rq-admin-member__action" onClick={() => setEditingUser(user)} aria-label={`Reset password for ${user.name}`}>
                  Reset password
                </button>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section className="rq-card rq-admin-card" aria-labelledby="admin-members-title">
      <div className="rq-admin-card__head">
        <h2 id="admin-members-title" className="rq-title rq-admin-card__title">Members</h2>
        <div className="rq-admin-card__aside">
          {!loading && !loadFailed && <span>{memberCountText(users.length)}</span>}
          <button type="button" className="rq-btn rq-btn--ghost rq-btn--compact" onClick={onRetry} disabled={loading} aria-label="Refresh members">
            Refresh
          </button>
        </div>
      </div>
      {list}

      <form className="rq-form rq-admin-add" noValidate onSubmit={onAdd} aria-label="Add member">
        <div className="rq-admin-add__fields">
          <TextField id="admin-new-name" label="Name" hideLabel placeholder="Name" autoComplete="off" value={newUser.name} onChange={(event) => setNewUser({ ...newUser, name: event.target.value })} />
          <TextField id="admin-new-email" label="Email" hideLabel type="email" placeholder="Email" autoComplete="off" value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} />
          <TextField id="admin-new-password" label="Password" hideLabel type="password" placeholder="Password · min 6 chars" autoComplete="new-password" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} />
          <button type="submit" className="rq-btn rq-btn--primary">Add member</button>
        </div>
        <FormNotices name="Members" status={notice?.status} error={notice?.error} />
      </form>
    </section>
  );
}
