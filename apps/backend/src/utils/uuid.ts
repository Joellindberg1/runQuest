const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Är värdet ett uuid? En uuid-kolumn som jämförs med en annan sträng ger ett databasfel (22P02, ett 500 och en Sentry-händelse),
 * så ett id som kommer ur en URL kontrolleras före frågan. Samma mönster finns lokalt i badges och news.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
