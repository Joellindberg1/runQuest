import { Link } from 'react-router-dom';
import { paths } from '@/paths';
import { cssVars } from '@/features/leaderboard/cssVars';
import { DeltaMark } from '@/features/leaderboard/components/BoardParts';
import { formatInt } from '@/features/log/logFormat';
import { useCountUp } from '../hooks/useCountUp';
import {
  LANDING_STATS, PACKS_RUNNING, PREVIEW_PACK_NAME, countUpValue, type HowStep, type PreviewRow,
} from '../landingModel';
import { ArenaTrack } from './ArenaTrack';

export const HOW_IT_WORKS_ID = 'how-it-works';

/** Märke · rubrik · arena-bana · ingress · knappar. EN guldknapp: Sign in (Create your pack väntar på multi-grupp, ägarbeslut 4). */
export function LandingHero() {
  return (
    <section className="rq-landing-hero" aria-labelledby="landing-title">
      <p className="rq-chip rq-chip--status rq-chip--gold rq-landing-badge">
        <span className="rq-dot rq-dot--live" aria-hidden="true" />
        {PACKS_RUNNING} packs running
      </p>
      <h1 id="landing-title" className="rq-display-xl rq-landing-title">
        Your group chat deserves a <span className="rq-landing-accent">leaderboard</span>
      </h1>
      <ArenaTrack />
      <p className="rq-lead rq-landing-lead">
        Every run earns XP. XP becomes levels, levels become titles. Strava syncs the runs — you bring the arguing.
      </p>
      <div className="rq-landing-cta">
        <Link to={paths.login} className="rq-btn rq-btn--primary rq-btn--lg">Sign in to your pack</Link>
        <a href={`#${HOW_IT_WORKS_ID}`} className="rq-btn rq-btn--ghost rq-btn--lg">See how it works</a>
        <p className="rq-landing-note">Starting your own pack is coming soon.</p>
      </div>
    </section>
  );
}

/** Aggregaten räknas upp en gång; skärmläsare får slutvärdet, inte mellanstegen. */
export function LandingStats() {
  const progress = useCountUp();
  return (
    <section className="rq-landing-stats" aria-labelledby="landing-stats-title">
      <h2 id="landing-stats-title" className="sr-only">RunQuest so far</h2>
      <dl className="rq-landing-stats__list">
        {LANDING_STATS.map((stat) => (
          <div key={stat.key} className="rq-landing-stat" data-tone={stat.tone}>
            <dt className="rq-landing-stat__label">{stat.label}</dt>
            <dd className="rq-landing-stat__value">
              <span aria-hidden="true">{formatInt(countUpValue(stat.value, progress))}</span>
              <span className="sr-only">{formatInt(stat.value)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Exempelflocken som ett live-kort: topp fem, förnamn, rank-pilar, staplar som växer en gång. */
export function PackPreview({ rows }: { rows: PreviewRow[] }) {
  return (
    <section className="rq-landing-preview" aria-labelledby="landing-preview-title">
      <span className="rq-landing-preview__sweep" aria-hidden="true" />
      <div className="rq-landing-preview__head">
        <h2 id="landing-preview-title" className="rq-landing-preview__title">{PREVIEW_PACK_NAME}</h2>
        <span className="rq-landing-preview__live">
          Live
        </span>
      </div>
      <ol className="rq-landing-preview__rows">
        {rows.map((row) => (
          <li key={row.id} className="rq-landing-row" data-tone={row.tone}>
            <span className="rq-landing-row__rank">{row.rank}</span>
            <div>
              <div className="rq-landing-row__line">
                <span className="rq-name">{row.name}</span>
                <DeltaMark delta={row.delta} />
              </div>
              <div className="rq-track" aria-hidden="true">
                <div className="rq-fill" style={cssVars({ '--w': `${row.pct}%`, '--rq-delay': row.delay })} />
              </div>
            </div>
            <span className="rq-landing-row__xp">{row.xp}<span className="sr-only"> XP</span></span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function HowItWorks({ steps }: { steps: HowStep[] }) {
  return (
    <section id={HOW_IT_WORKS_ID} className="rq-landing-how" aria-labelledby="landing-how-title">
      <h2 id="landing-how-title" className="rq-landing-eyebrow">How it works</h2>
      <ol className="rq-landing-steps" role="list">
        {steps.map((step) => (
          <li key={step.num} className="rq-landing-step">
            <div className="rq-landing-step__head">
              <span className="rq-landing-step__num" aria-hidden="true">{step.num}</span>
              <h3 className="rq-title rq-landing-step__title">{step.title}</h3>
            </div>
            <p className="rq-body rq-landing-step__body">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
