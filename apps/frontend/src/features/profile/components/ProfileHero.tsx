import type { ChangeEvent } from 'react';
import type { User } from '@runquest/types';
import { cssVars } from '@/features/leaderboard/cssVars';
import { getInitials } from '@/shared/utils/formatters';
import { useProfilePictureUpload } from '../hooks/useProfilePictureUpload';
import { formatInt } from '../profileFormat';
import { ACCEPTED_PICTURE_TYPES, xpToNextText, type RunnerHero, type StatCell } from '../profileModel';

/** Profilbilden: avatar + "Change photo". Uppladdningen (bild, högst 5 MB) bekräftas i en permanent live-region. */
function PhotoRow({ user }: { user: User }) {
  const { upload, uploading, notice } = useProfilePictureUpload();

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Samma fil ska gå att välja igen efter ett fel.
    event.target.value = '';
    void upload(file);
  };

  return (
    <div className="rq-profile-photo">
      <div className="rq-profile-photo__row">
        <span className="rq-avatar rq-profile-photo__avatar" aria-hidden="true">
          {user.profile_picture ? <img src={user.profile_picture} alt="" /> : getInitials(user.name)}
        </span>
        <span className="rq-profile-photo__text">Profile photo</span>
        <label className="rq-btn rq-btn--ghost rq-btn--compact rq-profile-photo__button" aria-disabled={uploading}>
          {uploading ? 'Uploading…' : 'Change photo'}
          <input type="file" accept={ACCEPTED_PICTURE_TYPES.join(',')} className="sr-only" disabled={uploading} onChange={onChange} />
        </label>
      </div>
      {/* Live regions måste finnas innan texten kommer för att annonseras: behållarna är permanenta, bara texten monteras. */}
      <div role="status" className="rq-profile-notice-slot">
        {notice?.tone === 'ok' && <p className="rq-profile-notice">{notice.text}</p>}
      </div>
      <div role="alert" className="rq-profile-notice-slot">
        {notice?.tone === 'error' && <p className="rq-profile-notice" data-tone="error">{notice.text}</p>}
      </div>
    </div>
  );
}

interface ProfileHeroProps {
  user: User;
  hero: RunnerHero;
  cells: StatCell[];
  /** Web Prototype har fem celler, App Prototype tre. */
  isDesktop: boolean;
}

/** Hjältekortet (`.rq-card--hero`): nivåring, namn · rank · rundor · XP kvar, statceller i hårlinjegrid och profilbilden. */
export function ProfileHero({ user, hero, cells, isDesktop }: ProfileHeroProps) {
  const visible = cells.filter((cell) => isDesktop || !cell.wideOnly);
  const percent = Math.round(hero.ringTurn * 100);
  const ringLabel = hero.nextLevel === null
    ? `Level ${hero.level}, max level`
    : `Level ${hero.level}, ${percent}% of the way to level ${hero.nextLevel}`;
  const standing = [hero.rank === null ? null : `#${hero.rank} in the group`, `${formatInt(hero.runs)} ${hero.runs === 1 ? 'run' : 'runs'}`].filter(Boolean).join(' · ');

  return (
    <section className="rq-card rq-card--hero rq-profile-hero" aria-label="Your profile" data-tour="profile-hero">
      <div className="rq-ring rq-profile-ring" role="img" aria-label={ringLabel} style={cssVars({ '--rq-ring-p': `${hero.ringTurn}turn` })}>
        <div className="rq-ring-hole">
          <span className="rq-profile-ring__level">{hero.level}</span>
          <span className="rq-profile-ring__caption">level</span>
        </div>
      </div>
      <div className="rq-profile-hero__who">
        <h1 className="rq-display rq-profile-hero__name">{hero.name}</h1>
        <p className="rq-profile-hero__meta">{standing}</p>
        <p className="rq-profile-hero__xp">{xpToNextText(hero)}</p>
      </div>

      <dl className="rq-hairgrid rq-profile-cells">
        {visible.map((cell) => (
          <div key={cell.key} className="rq-profile-cell" data-cell={cell.key}>
            <dt className="rq-profile-cell__label">{cell.label}</dt>
            <dd className="rq-profile-cell__value" data-tone={cell.tone}>{cell.value}</dd>
          </div>
        ))}
      </dl>

      <PhotoRow user={user} />
    </section>
  );
}
