// Om lean landningen just nu lämnar över till fullappen (AppHandoff visas). Sidvisningarna läser det: en överlämning är ingen sida besökaren sett, och
// fullappen räknar sin egen första sida efter omladdningen, så en visning härifrån vore en dubbelräkning.
//
// En räknare och inte en flagga: överlämningen kan monteras om (StrictMode, ett nytt mål) innan den förra hunnit avmonteras.
let active = 0;

/** Anropas när en överlämning börjar. Ger funktionen som avslutar den (när överlämningen avmonteras). */
export function beginHandoff(): () => void {
  active += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    active -= 1;
  };
}

/** Lämnar landningen över till appen just nu? */
export const isHandingOver = (): boolean => active > 0;
