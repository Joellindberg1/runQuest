import React from 'react';

interface RunQuestLogoProps {
  className?: string;
}

/**
 * RunQuest SVG logo — runner figure + "RUNQUEST" in Oswald condensed.
 *
 * Note: Lucide React does not include a running-person icon.
 * The runner here is a bespoke SVG figure sized to read clearly at 24–32px height.
 * Uses `currentColor` so it adapts automatically to any text/sidebar colour context.
 *
 * Runner anatomy (viewBox 0 0 165 40):
 *   - Head:          filled circle, positioned ahead of torso
 *   - Torso:         strong forward lean (~30°)
 *   - Right arm:     bent upward–forward at elbow (classic sprint arm drive)
 *   - Left arm:      bent downward–backward at elbow
 *   - Right leg:     knee raised, stride forward
 *   - Left leg:      extended and pushing off behind
 */
export const RunQuestLogo: React.FC<RunQuestLogoProps> = ({ className }) => (
  <svg
    viewBox="0 0 165 40"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="RunQuest"
    className={className}
    fill="none"
  >
    {/* ── Running figure ─────────────────────────────────────── */}
    <g
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Head */}
      <circle cx="20" cy="5" r="4.5" />

      {/* Torso */}
      <line x1="18" y1="10" x2="12" y2="23" />

      {/* Right arm — forward, bent UP at elbow */}
      <line x1="16" y1="14" x2="25" y2="8"  />
      <line x1="25" y1="8"  x2="29" y2="15" />

      {/* Left arm — back, bent DOWN at elbow */}
      <line x1="16" y1="14" x2="8"  y2="18" />
      <line x1="8"  y1="18" x2="6"  y2="25" />

      {/* Right leg — knee raised, stride forward */}
      <line x1="12" y1="23" x2="21" y2="30" />
      <line x1="21" y1="30" x2="25" y2="40" />

      {/* Left leg — pushing off behind */}
      <line x1="12" y1="23" x2="7"  y2="31" />
      <line x1="7"  y1="31" x2="3"  y2="40" />
    </g>

    {/* ── RUNQUEST text ──────────────────────────────────────── */}
    <text
      x="34"
      y="33"
      fontFamily="'Oswald', 'Arial Narrow', Arial, sans-serif"
      fontWeight="400"
      fontSize="28"
      letterSpacing="0.5"
      fill="currentColor"
    >
      RUNQUEST
    </text>
  </svg>
);
