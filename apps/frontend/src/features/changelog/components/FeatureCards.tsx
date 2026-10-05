import { RQIcon } from '@/shared/components/icons';
import type { FeatureEntry } from '../changelogTypes';

const ICON_FEATURE = 17;

interface FeatureCardsProps {
  features: readonly FeatureEntry[];
}

/** Fliken Features: det appen kan idag, ett kort per sak med grön tillståndskant ("det lever"). Kolumnerna är ett token (1 mobil · 3 desktop). */
export function FeatureCards({ features }: FeatureCardsProps) {
  return (
    <ul className="rq-changelog-grid">
      {features.map((feature) => (
        <li key={feature.title} className="rq-card rq-card--edge rq-changelog-feature">
          <h2 className="rq-changelog-feature__head">
            <span className="rq-changelog-feature__icon"><RQIcon name={feature.icon} size={ICON_FEATURE} /></span>
            <span className="rq-name">{feature.title}</span>
          </h2>
          <p className="rq-changelog-feature__body">{feature.body}</p>
        </li>
      ))}
    </ul>
  );
}
