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
    viewBox="0 0 168 40"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="RunQuest"
    className={className}
    fill="none"
  >
    {/* ── Running figure ── */}
    <g
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Head */}
      <circle cx="13" cy="6" r="3.8" />
      {/* Torso — leaning forward */}
      <line x1="13" y1="9.8" x2="9.5" y2="21" />
      {/* Right arm — forward */}
      <line x1="12" y1="14" x2="20" y2="18.5" />
      {/* Left arm — back */}
      <line x1="12" y1="14" x2="5" y2="10.5" />
      {/* Right leg — forward stride, bent at knee */}
      <polyline points="9.5,21 15.5,29 19,37" />
      {/* Left leg — pushing off behind */}
      <polyline points="9.5,21 6,29 2.5,37" />
    </g>

    {/* ── RUNQUEST text ── */}
    <text
      x="28"
      y="33"
      fontFamily="'Oswald', 'Arial Narrow', Arial, sans-serif"
      fontWeight="400"
      fontSize="30"
      letterSpacing="0.5"
      fill="currentColor"
    >
      RUNQUEST
    </text>
  </svg>
);
