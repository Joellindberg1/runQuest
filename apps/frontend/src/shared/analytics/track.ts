import type { AnalyticsEventName, AnalyticsTrackArgs } from '@runquest/shared';
import { createDefaultPageviewSender } from './umamiPageviews';

/**
 * Skickar en egen händelse till webbanalysen. Namnet måste stå i den fasta listan (`ANALYTICS_EVENTS` i packages/shared) och propsen får bara
 * vara de uppräknade värdena där: ett okänt namn, en okänd nyckel eller ett fritt värde är ett kompileringsfel, och vakten i sändaren avvisar
 * samma sak vid körning. Aldrig rundata, distanser, tider, namn, e-post eller id:n (Stravas API-policy 5.4).
 *
 * Utan webbplats-id i bygget (staging, lokalt, CI) gör anropet ingenting. Anropet kastar aldrig och väntar aldrig: statistiken får inte
 * påverka appen. Sidvisningar skickas av usePageviewTracking, inte härifrån.
 */
export function track<E extends AnalyticsEventName>(event: E, ...props: AnalyticsTrackArgs<E>): void {
  try {
    createDefaultPageviewSender().sendEvent(event, ...props);
  } catch {
    // Statistiken får aldrig fälla en lyckad handling i appen (en mutation, ett klick) som rapporterar den.
  }
}
