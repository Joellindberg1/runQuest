// Vitlistan för kampanjparametrarna som får följa med en sidvisning på landningen. Umami läser kampanjerna ur den skickade adressen, men ett fritt
// värde kan bära vad som helst (ett id, ett namn, en token), så bara värden som står här skickas, och då alltid listans eget värde, aldrig
// besökarens sträng. Okända värden och parametrar som saknas här (utm_term, utm_id …) tas bort.
//
// Lägga till en kampanjtagg: skriv den med små bokstäver i `utm_campaign` eller `utm_content` nedan och använd exakt den i länken som delas
// (docs/release.md, "Webbanalys: Umami Cloud"). Taggen ska vara ett ord eller en kort etikett, aldrig något som pekar ut en person.

export type UtmAllowlist = Readonly<Record<string, readonly string[]>>;

export const UTM_ALLOWLIST: UtmAllowlist = {
  utm_source: ['instagram', 'facebook', 'messenger', 'whatsapp', 'sms', 'email', 'linkedin', 'x', 'reddit', 'strava', 'qr'],
  utm_medium: ['social', 'referral', 'email', 'sms', 'qr', 'organic'],
  // Börjar tomma: kampanjtaggar läggs till när länkar delas.
  utm_campaign: [],
  utm_content: [],
};

/**
 * Query-strängen (`?utm_source=email`) med bara de parametrar och värden som står på listan, i listans ordning, eller en tom sträng.
 * Jämförelsen ignorerar skiftläge och det som skickas är listans eget värde.
 */
export function allowedUtmQuery(search: string, allowlist: UtmAllowlist = UTM_ALLOWLIST): string {
  const incoming = new URLSearchParams(search.split('#')[0]);
  const kept = new URLSearchParams();
  for (const [key, allowed] of Object.entries(allowlist)) {
    const value = incoming.get(key)?.trim().toLowerCase();
    const canonical = value === undefined ? undefined : allowed.find((candidate) => candidate.toLowerCase() === value);
    if (canonical !== undefined) kept.set(key, canonical);
  }
  const query = kept.toString();
  return query ? `?${query}` : '';
}
