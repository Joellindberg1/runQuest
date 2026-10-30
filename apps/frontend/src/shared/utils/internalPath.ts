const BACKSLASH = String.fromCharCode(92);
const LAST_CONTROL = 0x1f;
const DELETE = 0x7f;

/** Tab, radbrytning, CR och övriga kontrolltecken: webbläsarens URL-tolkning tar bort vissa av dem, så `/<tab>/evil.com` blir `//evil.com`. */
const hasControlCharacter = (text: string): boolean =>
  Array.from(text).some((char) => {
    const code = char.charCodeAt(0);
    return code <= LAST_CONTROL || code === DELETE;
  });

const staysOnThisOrigin = (next: string): boolean => {
  try {
    return new URL(next, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
};

/**
 * Är värdet en intern adress som appen får navigera till utan att bli en öppen redirect? En sträng som börjar med en enkel `/` (inte `//` och inte `/\`), utan
 * kontrolltecken, och som webbläsaren tolkar till samma origin. Delas av `?next=` efter login (`resolveNextPath`) och av `returnTo` i send-flödets route-state.
 */
export function isInternalPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith(`/${BACKSLASH}`)) return false;
  return !hasControlCharacter(value) && staysOnThisOrigin(value);
}
