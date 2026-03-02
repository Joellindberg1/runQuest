import React from 'react';

interface RunQuestLogoProps {
  className?: string;
}

/**
 * RunQuest SVG logo — runner figure + "RUNQUEST" in Oswald condensed.
 * Uses `currentColor` so it adapts automatically to any text color context.
 */
export const RunQuestLogo: React.FC<RunQuestLogoProps> = ({ className }) => (
  <svg
    viewBox="0 0 175 42"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="RunQuest"
    className={className}
    fill="none"
  >
    {/* ── Running figure (facing right, clear forward motion) ── */}
    <g
      stroke="currentColor"
      strokeWidth="2.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Head — positioned forward */}
      <circle cx="15" cy="5" r="3.8" />

      {/* Torso — strong forward lean */}
      <line x1="14" y1="9" x2="8" y2="21" />

      {/* Right arm — forward, bent upward at elbow */}
      <line x1="13" y1="13" x2="20" y2="8" />
      <line x1="20" y1="8" x2="23" y2="14" />

      {/* Left arm — back, bent downward at elbow */}
      <line x1="12" y1="13" x2="5" y2="17" />
      <line x1="5"  y1="17" x2="4"  y2="24" />

      {/* Right leg — knee raised, stride forward */}
      <line x1="8"  y1="21" x2="17" y2="26" />
      <line x1="17" y1="26" x2="20" y2="37" />

      {/* Left leg — pushing off behind */}
      <line x1="8" y1="21" x2="5"  y2="30" />
      <line x1="5" y1="30" x2="2"  y2="38" />
    </g>

    {/* ── RUNQUEST text ── */}
    <text
      x="29"
      y="33"
      fontFamily="'Oswald', 'Arial Narrow', Arial, sans-serif"
      fontWeight="400"
      fontSize="29"
      letterSpacing="0.5"
      fill="currentColor"
    >
      RUNQUEST
    </text>
  </svg>
);
