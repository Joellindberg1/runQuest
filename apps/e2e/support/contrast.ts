/**
 * Textkontrast mätt i webbläsaren. Funktionen skickas till `page.evaluate(contrastOf, selectors)` och körs i sidan, så den får inte läsa något utanför sig själv.
 * Varje element mäts för sig: dess textfärg (med eventuell alfa) mot dess sammansatta bakgrund, alltså elementets egen bakgrund ovanpå alla föräldrars, över vitt längst ned.
 * En tonad yta (nivåns 12 % tint) ger därmed sitt riktiga värde och inte kontrasten mot sidan under.
 */
export interface ContrastSample {
  selector: string;
  index: number;
  text: string;
  ratio: number;
}

export interface ContrastRequest {
  selectors: string[];
  /** Mät kantlinjen (border-top) mot ytan utanför elementet i stället för texten mot elementets egen bakgrund. */
  edge?: boolean;
}

export function contrastOf({ selectors, edge = false }: ContrastRequest): ContrastSample[] {
  type Rgba = { r: number; g: number; b: number; a: number };
  const parse = (value: string): Rgba => {
    const match = value.match(/(?:rgba?|color\(srgb)\s*\(?([^)]+)\)/);
    if (!match || !match[1]) return { r: 0, g: 0, b: 0, a: 0 };
    const parts = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    const scale = value.startsWith('color(') ? 255 : 1;
    return { r: (parts[0] ?? 0) * scale, g: (parts[1] ?? 0) * scale, b: (parts[2] ?? 0) * scale, a: parts[3] ?? 1 };
  };
  const over = (top: Rgba, bottom: Rgba): Rgba => {
    const alpha = top.a + bottom.a * (1 - top.a);
    if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const mix = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / alpha;
    return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: alpha };
  };
  const backgroundOf = (element: Element): Rgba => {
    const layers: Rgba[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) layers.push(parse(getComputedStyle(node).backgroundColor));
    let composite: Rgba = { r: 255, g: 255, b: 255, a: 1 };
    for (let index = layers.length - 1; index >= 0; index -= 1) composite = over(layers[index] ?? { r: 0, g: 0, b: 0, a: 0 }, composite);
    return composite;
  };
  const luminance = ({ r, g, b }: Rgba) => {
    const channel = (value: number) => {
      const scaled = value / 255;
      return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const ratio = (a: Rgba, b: Rgba) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

  return selectors.flatMap((selector) =>
    Array.from(document.querySelectorAll(selector)).map((element, index) => {
      const style = getComputedStyle(element);
      const background = backgroundOf(edge ? (element.parentElement ?? element) : element);
      const text = over(parse(edge ? style.borderTopColor : style.color), background);
      return { selector, index, text: (element.textContent ?? '').trim(), ratio: Number(ratio(text, background).toFixed(2)) };
    }),
  );
}
