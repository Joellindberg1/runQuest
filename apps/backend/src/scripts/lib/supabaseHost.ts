/** Hostname ur SUPABASE_URL (aldrig nycklar/sökväg). 'unknown' om variabeln saknas eller är ogiltig. Delad av skripten som skriver ut sitt mål. */
export function supabaseHost(url: string | undefined = process.env.SUPABASE_URL): string {
  try {
    return (url && new URL(url).host) || 'unknown';
  } catch {
    return 'unknown';
  }
}
