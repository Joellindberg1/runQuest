import React from 'react';

interface RunQuestLogoProps {
  className?: string;
}

/**
 * RunQuest SVG logo — runner figure + "RUNQUEST" in Oswald condensed.
 *
 * Note: Lucide React does not include a running-person icon.
 * The runner here is a bespoke SVG figure sized to read clearly at 24–40px height.
 * Uses `currentColor` so it adapts automatically to any text/sidebar colour context.
 *
 * Runner anatomy (viewBox 0 0 165 40):
 *   - Head:        filled circle, leading slightly ahead of torso
 *   - Torso:       strong forward lean (~45°)
 *   - Right arm:   up-forward at shoulder, elbow bends back down (sprint drive)
 *   - Left arm:    back and down behind torso (counterswing)
 *   - Right leg:   HIGH knee drive — thigh nearly horizontal, shin drops down
 *   - Left leg:    pushing off behind, extends back
 */
export const RunQuestLogo: React.FC<RunQuestLogoProps> = ({ className }) => (
  <svg
    viewBox="0 0 165 40"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="RunQuest"
    className={className}
    fill="currentColor"
  >
{/* ── Running figure (Refined and slightly thinner lines) ────────────────────────────────── */}
<g
  stroke="currentColor"
  strokeWidth="3.5" /* Något smalare linjer för en lite lättare känsla */
  strokeLinecap="round"
  strokeLinejoin="round"
>
  {/* Huvud — fylld cirkel */}
  <circle cx="23" cy="3.25" r="3.5" fill="currentColor" stroke="none" />

  {/* Torso — framåtlutande linje */}
  <line x1="21" y1="8.5" x2="16" y2="20" />

  {/* Främre arm (löparens högra, till höger i bilden) — "L"-form flyttad lite längre fram */}
  {/* Justering: Flyttade de yttre punkterna (x2, x2) och den mellersta punkten (x2/y2, x1/y1) något framåt. */}
  <line x1="20.5" y1="8.5" x2="27.5" y2="17.5" />
  <line x1="33" y1="13" x2="28.5" y2="16.5" />

  {/* Bakre arm (löparens vänstra, till vänster i bilden) — "V"-form bakåt */}
  <line x1="19.3" y1="8.7" x2="12" y2="10" />
  <line x1="12" y1="10" x2="10" y2="15" />

  {/* Främre ben (löparens högra, till höger i bilden) — lår fram, smalben ner */}
  <line x1="16" y1="20" x2="23" y2="23.5" />
  <line x1="23" y1="23.5" x2="20" y2="33" />

  {/* Bakre ben (löparens vänstra, till vänster i bilden) — sträckt bakåt och neråt med lite böj */}
  {/* Justering: Lagt till en mellersta punkt och ändrat banan för att ge en svag böj i knät istället för en helt rak linje. */}
  <path d="M16 20 L11 27 Q10 29, 6.5 33.5" fill="none" />
</g>

    {/* ── RUNQUEST text ──────────────────────────────────────── */}
    <text
      x="40"
      y="25"
      fontFamily="'Oswald', 'Arial Narrow', Arial, sans-serif"
      fontWeight="400"
      fontSize="28"
      letterSpacing="0.5"
      fill="currentColor"
    >
      RUNQUEST
    </text>
        <text
      x="45"
      y="40.1"
      fontFamily="'Oswald', 'Arial Narrow', Arial, sans-serif"
      fontWeight="400"
      fontSize="12"
      letterSpacing="0.75"
      fill="currentColor"
    >
      RUN - RANK - REIGN
    </text>
  </svg>
);
