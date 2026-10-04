import type { EffectRow, XpPreview } from '../xpPreviewModel';

interface XpCardProps {
  preview: XpPreview;
  isDesktop: boolean;
  /** XP-konfigen gick inte att läsa — förhandsvisningen räknar med standardreglerna. */
  usingDefaults: boolean;
}

/** "Estimated XP": stora guldsiffran och uppställningen (base, distans, bonus, streak) ur shared-formeln. */
export function XpCard({ preview, isDesktop, usingDefaults }: XpCardProps) {
  return (
    <section className="rq-card rq-log-xp" aria-label="Estimated XP">
      <p className="rq-label rq-log-xp__eyebrow">Estimated XP</p>
      <p className="rq-log-xp__total" data-ready={preview.ready}>
        {preview.total}
      </p>
      <ul className="rq-hairgrid rq-log-xp__rows">
        {preview.rows.map((row) => (
          <li key={row.key} className="rq-log-xp__row">
            <span className="rq-log-xp__label">{row.label}</span>
            <span className="rq-log-xp__value" data-tone={row.tone}>
              {row.value}
            </span>
          </li>
        ))}
      </ul>
      <p className="rq-log-xp__note">
        {isDesktop ? 'The server recalculates when it saves — active boosts are added then.' : 'Active boosts are added when it saves.'}
      </p>
      {usingDefaults && <p className="rq-log-xp__note">Showing the standard XP rules — the live settings could not be loaded.</p>}
    </section>
  );
}

/** "What this run does": streak, nivå, Frodos resa och rankingen efter rundan. */
export function EffectsCard({ effects }: { effects: EffectRow[] }) {
  return (
    <section className="rq-card rq-log-effects" aria-label="What this run does">
      <p className="rq-label rq-log-effects__eyebrow">What this run does</p>
      <ul className="rq-hairgrid rq-log-effects__rows">
        {effects.map((effect) => (
          <li key={effect.key} className="rq-log-effects__row">
            <span className="rq-log-effects__label">{effect.label}</span>
            <span className="rq-log-effects__value" data-tone={effect.tone}>
              {effect.value}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
