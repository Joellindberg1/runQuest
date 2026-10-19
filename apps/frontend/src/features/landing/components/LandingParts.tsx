import type { ReactNode } from 'react';
import { cssVars } from '@/features/leaderboard/cssVars';
import { DeltaMark } from '@/features/leaderboard/components/BoardParts';
import { track } from '@/shared/analytics/track';
import {
  HOW_IT_WORKS_ID, LEAD_DESKTOP, LEAD_MOBILE, PREVIEW_NOTES, PREVIEW_PACK_NAME, WAITLIST_ID,
  type HowStep, type PreviewRow, type XpFormula as XpFormulaView,
} from '../landingModel';
import { ArenaTrack } from './ArenaTrack';
import { LandingStats } from './LandingStats';

interface LandingHeroProps {
  /** Knappen bredvid guldknappen: "Watch the film" (Lead byter in filmens knapp här). */
  watchFilm: ReactNode;
  /** Filmen i hjältens textspalt på mobil, mellan knapparna och sifferraden (Lead byter in den här; CSS döljer den från 1024 px). */
  mobileFilm: ReactNode;
}

/**
 * Rubrik · arena-bana · ingress · knappar · film (mobil) · sifferrad. EN guldknapp på hela sidan: Join the waitlist (formuläret längre ned
 * har samma namn och mål men syns aldrig samtidigt). Radbrytningarna i h1 görs av `<br>` som CSS döljer på mobil, så rubriken flyter där.
 * Ingressen finns i en kort och en lång variant i samma stycke och CSS visar en av dem (förrenderingen vet inte bredden, ADR 006).
 */
export function LandingHero({ watchFilm, mobileFilm }: LandingHeroProps) {
  return (
    <section className="rq-landing-hero" aria-labelledby="landing-title">
      <h1 id="landing-title" className="rq-display-xl rq-landing-title">
        Your group chat <br className="rq-landing-break" />deserves a <br className="rq-landing-break" /><span className="rq-landing-accent">leaderboard</span>
      </h1>
      <ArenaTrack />
      <p className="rq-lead rq-landing-lead">
        <span className="rq-landing-lead__short">{LEAD_MOBILE}</span>
        {' '}
        <span className="rq-landing-lead__long">{LEAD_DESKTOP}</span>
      </p>
      <div className="rq-landing-cta">
        <a href={`#${WAITLIST_ID}`} className="rq-btn rq-btn--primary rq-btn--lg" onClick={() => track('waitlist-click')}>Join the waitlist</a>
        {watchFilm}
      </div>
      <div className="rq-landing-hero__film">{mobileFilm}</div>
      <LandingStats />
    </section>
  );
}

/**
 * Exempelflocken som ett kort med levande ring och sweep: topp fem, förnamn, rank-pilar, staplar som växer en gång. Märkt "Example",
 * inte "Live" — kortet är påhittat. Desktop sätter tre förklaringar bredvid; mobil visar bara kortet (rubriken finns kvar, gömd).
 * Ögonbrynet och förklaringarna ligger alltid i HTML och CSS visar dem från 1024 px; rubriken är visuellt gömd under det.
 */
export function PackPreview({ rows }: { rows: PreviewRow[] }) {
  return (
    <section className="rq-landing-showcase" aria-labelledby="landing-showcase-title">
      <p className="rq-landing-eyebrow rq-landing-eyebrow--desktop">This is what your pack sees</p>
      <h2 id="landing-showcase-title" className="rq-landing-h2 rq-landing-h2--desktop">The leaderboard, live</h2>
      <div className="rq-landing-showcase__body">
        <div className="rq-landing-preview">
          <span className="rq-landing-preview__sweep" aria-hidden="true" />
          <div className="rq-landing-preview__head">
            <h3 className="rq-landing-preview__title">{PREVIEW_PACK_NAME}</h3>
            <span className="rq-landing-preview__tag">Example</span>
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
        </div>
        <div className="rq-landing-notes">
          {PREVIEW_NOTES.map((note) => (
            <div key={note.title} className="rq-landing-note">
              <h3 className="rq-landing-note__title">{note.title}</h3>
              <p className="rq-body rq-landing-note__body">{note.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** XP-formeln i fyra termer och exemplet 10 km → +50 XP; talen kommer ur shared. Termerna är dekor, meningen för skärmläsare är texten. */
function XpFormula({ formula }: { formula: XpFormulaView }) {
  const operators = ['+', '+', '×'] as const;
  const lastTerm = formula.terms.length - 1;

  return (
    <div className="rq-landing-formula" role="group" aria-labelledby="landing-formula-title">
      <div>
        <p id="landing-formula-title" className="rq-landing-formula__label">The XP formula, no secrets</p>
        <p className="sr-only">{formula.spoken}</p>
        <div className="rq-landing-formula__terms" aria-hidden="true">
          {formula.terms.map((term, index) => (
            <span key={term} className="rq-landing-formula__fragment">
              <span className="rq-landing-formula__term" data-tone={index === lastTerm ? 'gold' : undefined}>{term}</span>
              {index < lastTerm && <span className="rq-landing-formula__op">{operators[index]}</span>}
            </span>
          ))}
        </div>
      </div>
      <div className="rq-landing-formula__example">
        <p className="rq-landing-formula__label">A {formula.example.km} km run today</p>
        <p className="rq-landing-formula__value">+{formula.example.xp} XP</p>
      </div>
    </div>
  );
}

/** De fyra stegen som en lista (mobil: kort med vänsterkant, desktop: fyra kolumner med guldkant upptill) och formeln under. */
export function HowItWorks({ steps, formula }: { steps: HowStep[]; formula: XpFormulaView }) {
  return (
    <section id={HOW_IT_WORKS_ID} className="rq-landing-how" aria-labelledby="landing-how-title">
      <p className="rq-landing-eyebrow">How the game works</p>
      <h2 id="landing-how-title" className="rq-landing-h2 rq-landing-h2--desktop">Four things decide your rank</h2>
      <ol className="rq-landing-steps" role="list">
        {steps.map((step) => (
          <li key={step.num} className="rq-landing-step">
            <div className="rq-landing-step__head">
              <span className="rq-landing-step__num" aria-hidden="true">{step.num}</span>
              <h3 className="rq-landing-step__title">{step.title}</h3>
            </div>
            <p className="rq-body rq-landing-step__body">{step.body}</p>
          </li>
        ))}
      </ol>
      <XpFormula formula={formula} />
    </section>
  );
}
