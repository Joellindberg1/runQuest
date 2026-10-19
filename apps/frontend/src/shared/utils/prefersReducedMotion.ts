/**
 * Läser rörelsepreferensen vid ett klick, aldrig under rendering: första renderingen får inte bero på webbläsaren (förrenderad landning).
 * Saknas `matchMedia` (äldre miljöer, jsdom) räknas rörelse som tillåten.
 */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
