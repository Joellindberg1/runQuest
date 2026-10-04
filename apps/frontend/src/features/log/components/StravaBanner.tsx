import { Link } from 'react-router-dom';
import { paths } from '@/paths';
import { RQIcon } from '@/shared/components/icons';
import type { StravaBanner as StravaBannerModel } from '../stravaModel';

const ICON_SIZE = 17;

/** Mobilens Strava-rad överst på formuläret: kopplad (grön, synkraden) eller en väg till Settings. */
export function StravaBanner({ banner }: { banner: StravaBannerModel }) {
  return (
    <section className="rq-log-strava" data-tone={banner.tone} aria-label="Strava">
      <RQIcon name="sync" size={ICON_SIZE} />
      <div className="rq-log-strava__text">
        <p className="rq-log-strava__title">{banner.title}</p>
        <p className="rq-log-strava__sub">{banner.text}</p>
      </div>
      {banner.needsSettings && (
        <Link to={paths.settings} className="rq-btn rq-btn--link">
          Settings
        </Link>
      )}
    </section>
  );
}
