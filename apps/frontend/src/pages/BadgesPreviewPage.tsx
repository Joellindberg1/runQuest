import React, { useState } from 'react';
import { BADGE_SERIES, MAX_SHOWCASE, MAX_TIER, TIER_NAMES } from '@runquest/shared';
import type { BadgeUserItem } from '@runquest/shared';
import { buildBadgeSummary, buildCollection, toggleShowcase, type BadgeRow } from '@/features/badges/badgeModel';
import type { GroupBadges } from '@/features/badges/api';
import { BadgeEmblem, type BadgeSize } from '@/features/badges/components/BadgeEmblem';
import { BadgeEmblemDetail } from '@/features/badges/components/BadgeEmblemDetail';
import { BadgePips } from '@/features/badges/components/BadgePips';
import { BadgeSeriesCard, type ShowcaseToggle } from '@/features/badges/components/BadgeSeriesCard';
import { tierKey } from '@/features/badges/components/badgeTier';
// Emblem-popovern använder skalets delade .rq-popover-lager (yta, kant, skugga); arket ligger utanför AppShell och laddar därför skalets stil själv.
import '@/app-shell/app-shell.css';
import './preview/badgeSheet.css';

// /preview/badges — emblem-arket (F1, docs/design/badges/reference/f1.png) med de riktiga komponenterna, utan inloggning och utan backend.
// Serier och nivånamn läses ur @runquest/shared; bara bildtexterna under emblemen är arkets egna.
// RUN-149: byggstenarna för badges-sidan (liggande kort med växlare, emblemknapp med detaljpopover) med påhittad data — ingen backend, ingen inloggning.

const TIERS = Array.from({ length: MAX_TIER }, (_, index) => index + 1);
const SIZES: ReadonlyArray<{ size: BadgeSize; label: string }> = [
  { size: 'sm', label: 'MINI · 28 PX · ICON 15' },
  { size: 'cp', label: 'SMALL (CP) · 44 PX · ICON 20' },
  { size: 'md', label: 'MEDIUM · 56 PX · ICON 24' },
  { size: 'lg', label: 'LARGE · 96 PX · ICON 42' },
];
/** Bildtexten per nivå (F1 rad 1), index = tier - 1. */
const TIER_NOTES = ['NO GLOW', 'NO GLOW', 'STATIC GLOW', 'GLOW + HAIRLINE RING', 'STATIC GLOW', 'BREATHES · M/L ONLY'];
const ANATOMY = [
  ['Glow wrapper', 'drop-shadow; none below Rare, static from Rare, Legendary breathes (M/L only, three cycles)'],
  ['Crest frame', 'clip-path crest, tier gradient'],
  ['Hairline ring', 'Heroic only, its non-colour mark'],
  ['Core', 'dark fill, same crest clip'],
  ['Series icon', 'RQIcon, 15 / 20 / 24 / 42 px, same on every tier'],
] as const;

const SHOWCASE = [
  { series: BADGE_SERIES[3], tier: 6 },
  { series: BADGE_SERIES[4], tier: 4 },
  { series: BADGE_SERIES[0], tier: 3 },
];

// ── RUN-149: byggstenarna med påhittad data ─────────────────────────────────────────────────────────────────────────────
// Fem intjänade serier (index i BADGE_SERIES → nivå), tre låsta, en flock på sex. Held-by följer nivån: nivå 1 hålls av alla, nivå 6 bara av mig.
const PACK_SIZE = 6;
const SAMPLE_TIERS = [3, 2, 1, MAX_TIER, 4];
const SAMPLE_ITEMS: BadgeUserItem[] = SAMPLE_TIERS.map((tier, index) => ({ series: BADGE_SERIES[index].key, tier, earned_at: '2026-10-01T12:00:00Z', seen_tier: tier }));
const SAMPLE_GROUP: GroupBadges = {
  members: [],
  member_count: PACK_SIZE,
  holders: Object.fromEntries(
    BADGE_SERIES.map((series) => [series.key, Object.fromEntries(Array.from({ length: MAX_TIER }, (_, index) => [String(index + 1), Math.max(1, PACK_SIZE - index)]))]),
  ),
};
const SAMPLE_ROWS: BadgeRow[] = buildCollection({ items: SAMPLE_ITEMS, showcase: [BADGE_SERIES[3].key, BADGE_SERIES[0].key] }, SAMPLE_GROUP, { viewerId: 'me', ownerId: 'me' });
const SAMPLE_OWNED = SAMPLE_ROWS.filter((row) => row.earned).map((row) => row.series);
const LIMIT_TEXT = `${MAX_SHOWCASE} of ${MAX_SHOWCASE} on display — remove one first.`;
const noop = () => undefined;

const switcher = (limitId: string, overrides: Partial<ShowcaseToggle> = {}): ShowcaseToggle => ({ position: null, full: false, saving: false, limitId, onToggle: noop, ...overrides });

/** Varje växlarläge som ett eget kort (spec F9.6): Show · On display — 2 · fullt · sparar (icke vald) · sparar (vald) · låst. */
const CardModes: React.FC = () => {
  const limitId = 'bs-limit-modes';
  const row = (index: number) => SAMPLE_ROWS[index];
  return (
    <>
      <p id={limitId} className="rq-badge-sheet__note">{LIMIT_TEXT}</p>
      <ul className="rq-badge-page-grid" aria-label="Badge series, every toggle mode">
        <BadgeSeriesCard row={row(2)} toggle={switcher(limitId)} />
        <BadgeSeriesCard row={row(0)} toggle={switcher(limitId, { position: 2 })} />
        <BadgeSeriesCard row={row(1)} toggle={switcher(limitId, { full: true })} />
        <BadgeSeriesCard row={row(4)} toggle={switcher(limitId, { saving: true })} />
        <BadgeSeriesCard row={row(3)} toggle={switcher(limitId, { saving: true, position: 1 })} />
        <BadgeSeriesCard row={row(5)} toggle={switcher(limitId)} />
      </ul>
    </>
  );
};

/** Ett levande utkast över alla åtta serier: tryck på växlarna, nå 3 av 3, simulera sparande. Lokalt tillstånd — ingen cache och inget nätverk. */
const LiveCards: React.FC = () => {
  const limitId = 'bs-limit-live';
  const [picked, setPicked] = useState<string[]>(() => SAMPLE_ROWS.filter((row) => row.displayPosition !== null).map((row) => row.series));
  const [saving, setSaving] = useState(false);
  const full = picked.length >= MAX_SHOWCASE;
  return (
    <>
      <div className="rq-badge-sheet__controls">
        <button type="button" className="rq-btn rq-btn--secondary rq-btn--compact" aria-pressed={saving} onClick={() => setSaving((on) => !on)}>
          Simulate saving
        </button>
        <div aria-live="polite">{full && <p id={limitId} className="rq-badge-sheet__note">{LIMIT_TEXT}</p>}</div>
      </div>
      <ul className="rq-badge-page-grid" aria-label="Badge series">
        {SAMPLE_ROWS.map((row) => (
          <BadgeSeriesCard
            key={row.series}
            row={row}
            toggle={switcher(limitId, {
              position: picked.includes(row.series) ? picked.indexOf(row.series) + 1 : null,
              full,
              saving,
              onToggle: () => setPicked((current) => toggleShowcase(current, SAMPLE_OWNED, row.series)),
            })}
          />
        ))}
      </ul>
    </>
  );
};

/** De 44 px stora emblemknapparna som profilens sammanfattning och Runner card kommer att ha: intjänade på nivå, låsta under en hårlinje. */
const EmblemDetails: React.FC = () => {
  const { earned, locked, lockedCount } = buildBadgeSummary(SAMPLE_ROWS);
  return (
    <div className="rq-card rq-badge-sheet__summary">
      <ul className="rq-badge-sheet__emblem-row" aria-label="Earned badges">
        {earned.map((row) => (
          <li key={row.series}><BadgeEmblemDetail row={row} /></li>
        ))}
      </ul>
      <ul className="rq-badge-sheet__emblem-row rq-badge-sheet__emblem-row--locked" aria-label="Locked badges">
        {locked.map((row) => (
          <li key={row.series}><BadgeEmblemDetail row={row} /></li>
        ))}
        <li className="rq-eyebrow">{lockedCount} locked</li>
      </ul>
    </div>
  );
};

const Section: React.FC<{ id: string; title: string; children: React.ReactNode }> = ({ id, title, children }) => (
  <section className="rq-badge-sheet__section" aria-labelledby={id}>
    <h2 id={id} className="rq-eyebrow rq-badge-sheet__eyebrow">
      {title}
    </h2>
    {children}
  </section>
);

const BadgesPreviewPage: React.FC = () => {
  // "Replay" monterar om tändnings-/andningsraderna: CSS-animationer startar bara när elementet monteras.
  const [replay, setReplay] = useState(0);
  const seriesA = BADGE_SERIES[0];
  const showcaseLabel = `Badges: ${SHOWCASE.map(({ series, tier }) => `${TIER_NAMES[tier - 1]} ${series.name}`).join(', ')}`;

  return (
    <main className="rq-badge-sheet">
      <header className="rq-badge-sheet__head">
        <p className="rq-eyebrow">RunQuest · Design language</p>
        <h1 className="rq-display-xl">BADGES</h1>
      </header>

      <Section id="bs-tiers" title="Six tiers · large 96 px">
        <ul className="rq-badge-sheet__tiers">
          {TIERS.map((tier) => (
            <li key={tier} className="rq-badge-sheet__tier-card">
              <BadgeEmblem series={seriesA.key} tier={tier} size="lg" />
              <span className="rq-chip rq-chip--status rq-badge-chip" data-tier={tierKey(tier)}>
                {TIER_NAMES[tier - 1]}
              </span>
              <BadgePips tier={tier} />
              <span className="rq-eyebrow">{TIER_NOTES[tier - 1]}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="bs-matrix" title="Eight series × six tiers · medium 56 px">
        <table className="rq-badge-sheet__matrix">
          <thead>
            <tr>
              <th scope="col">Series</th>
              {TIERS.map((tier) => (
                <th key={tier} scope="col">
                  {TIER_NAMES[tier - 1]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BADGE_SERIES.map((series) => (
              <tr key={series.key}>
                <th scope="row">{series.name}</th>
                {TIERS.map((tier) => (
                  <td key={tier}>
                    <BadgeEmblem series={series.key} tier={tier} size="md" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section id="bs-locked" title="Locked · dim frame, icon at .28, no glow, empty pips">
        <ul className="rq-badge-sheet__locked">
          {BADGE_SERIES.map((series) => (
            <li key={series.key}>
              <BadgeEmblem series={series.key} tier={null} size="md" />
              <BadgePips tier={null} decorative />
              <span className="rq-eyebrow">{series.name}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="bs-sizes" title="Sizes · height = width × 1.12 · Legendary never breathes at mini or cp">
        {SIZES.map(({ size, label }) => (
          <div key={size} className="rq-badge-sheet__size-row">
            <span className="rq-eyebrow rq-badge-sheet__size-label">{label}</span>
            <div className="rq-badge-sheet__size-emblems">
              {TIERS.map((tier) => (
                <BadgeEmblem key={tier} series={seriesA.key} tier={tier} size={size} />
              ))}
            </div>
          </div>
        ))}
      </Section>

      <Section id="bs-chips" title="Tier chips on a collection card (contrast check, chip tint .06)">
        <div className="rq-card">
          <div className="rq-badge-card">
            <div className="rq-badge-sheet__size-emblems">
              {TIERS.map((tier) => (
                <span key={tier} className="rq-chip rq-chip--status rq-badge-chip" data-tier={tierKey(tier)}>
                  {TIER_NAMES[tier - 1]}
                </span>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section id="bs-panel" title="1:1 mini on a panel">
        <div className="rq-card rq-badge-sheet__panel">
          <span className="rq-name">Nova Ridley</span>
          <span role="img" aria-label={showcaseLabel} className="rq-badge-sheet__minis">
            {SHOWCASE.map(({ series, tier }) => (
              <BadgeEmblem key={series.key} series={series.key} tier={tier} size="sm" decorative />
            ))}
          </span>
        </div>
      </Section>

      <Section id="bs-heroic" title="Heroic ring at mini · 28 px vs Uncommon (verification, Council 5)">
        <div className="rq-badge-sheet__heroic-check">
          {[2, 4].map((tier) => (
            <figure key={tier} className="rq-badge-sheet__heroic-case">
              <BadgeEmblem series={seriesA.key} tier={tier} size="sm" />
              <BadgePips tier={tier} />
              <figcaption className="rq-eyebrow">{TIER_NAMES[tier - 1]} · colour</figcaption>
            </figure>
          ))}
          {[2, 4].map((tier) => (
            <figure key={tier} className="rq-badge-sheet__heroic-case rq-badge-sheet__gray">
              <BadgeEmblem series={seriesA.key} tier={tier} size="sm" />
              <BadgePips tier={tier} />
              <figcaption className="rq-eyebrow">{TIER_NAMES[tier - 1]} · greyscale</figcaption>
            </figure>
          ))}
          {[2, 4].map((tier) => (
            <figure key={tier} className="rq-badge-sheet__heroic-case rq-badge-sheet__gray">
              <BadgeEmblem series={seriesA.key} tier={tier} size="md" />
              <BadgePips tier={tier} />
              <figcaption className="rq-eyebrow">{TIER_NAMES[tier - 1]} · medium, greyscale</figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <Section id="bs-motion" title="Motion · ignite once (0.9 s) · Legendary breathes three cycles, then static">
        <button type="button" className="rq-btn rq-btn--secondary" onClick={() => setReplay((count) => count + 1)}>
          Replay
        </button>
        <div key={replay} className="rq-badge-sheet__motion">
          <div className="rq-badge-sheet__size-row">
            <span className="rq-eyebrow rq-badge-sheet__size-label">IGNITE · POPUP</span>
            <div className="rq-badge-sheet__size-emblems">
              {TIERS.map((tier) => (
                <BadgeEmblem key={tier} series={seriesA.key} tier={tier} size="lg" ignite />
              ))}
            </div>
          </div>
          <div className="rq-badge-sheet__size-row">
            <span className="rq-eyebrow rq-badge-sheet__size-label">LEGENDARY · BREATHES (M/L), STATIC (S/CP)</span>
            <div className="rq-badge-sheet__size-emblems">
              {SIZES.map(({ size }) => (
                <BadgeEmblem key={size} series={seriesA.key} tier={MAX_TIER} size={size} />
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section id="bs-card-modes" title="Landscape card · every toggle mode (Show, On display, full, saving, locked)">
        <CardModes />
      </Section>

      <Section id="bs-card-live" title="Landscape cards · live draft (tap Show, reach 3 of 3, simulate saving)">
        <LiveCards />
      </Section>

      <Section id="bs-detail" title="Emblem detail · 44 px buttons open a popover (tap, Enter or Space; Esc closes)">
        <EmblemDetails />
      </Section>

      <Section id="bs-anatomy" title="Anatomy">
        <div className="rq-card rq-badge-sheet__anatomy">
          <BadgeEmblem series={BADGE_SERIES[3].key} tier={MAX_TIER} size="lg" />
          <ol className="rq-badge-sheet__anatomy-list">
            {ANATOMY.map(([part, text]) => (
              <li key={part}>
                <strong>{part}</strong> — {text}
              </li>
            ))}
          </ol>
        </div>
      </Section>
    </main>
  );
};

export default BadgesPreviewPage;
