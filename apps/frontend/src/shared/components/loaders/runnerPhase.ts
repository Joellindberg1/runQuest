/**
 * Löparprickarnas fas räknas från klockan (stadion-ovalen, TrackLoader). Laddningsvyn byter nod flera gånger på vägen till första bilden av appen (index.html,
 * React, gaten) och dokument en gång till (landningens överlämning), och en animation som skapas på nytt börjar på sin nolla: prickarna hoppade ett halvt varv.
 * Genom att sätta varje animations starttid så att `(klockan + prickens fördröjning) mod varvtiden` styr var pricken står, fortsätter den där den var, i vilken
 * nod och vilket dokument den än ritas.
 *
 * Starttiden sätts direkt på animationsobjektet (Web Animations), inte som en negativ `animation-delay` i CSS: en CSS-animation får sin starttid först i nästa bildruta,
 * och hydrering eller en tung commit kan ligga emellan, så en fördröjning räknad vid skapandet hamnar efter. Dokumentets tidslinje börjar vid `performance.timeOrigin`
 * (millisekunder sedan epoken), så `-timeOrigin` som starttid gör att tidslinjens tid plus `timeOrigin` är väggklockan. Det räcker att veta resten mot varvtiden.
 *
 * Markupen är oförändrad (förrenderingen och klientens första rendering är identiska); fasen sätts efter att noden finns, av refen i TrackLoader och, för
 * laddaren i index.html före all JS, av ett litet inline-skript (`runnerPhaseScript`).
 */

/** Laddarens rot i markupen (`data-track-loader` i TrackLoader): skriptet i index.html rättar den laddare en prick startar i, och landningens egna löpare (`rqOrbit` på SVG-cirklar) berörs aldrig. */
export const RUNNER_PHASE_SELECTOR = '[data-track-loader]';

/** Klassen på `<html>` medan den förrenderade laddarens prickar väntar på sin fas: temafilen (index.css) döljer dem så länge, så ingen bildruta visar en prick på sin egen nolla. */
export const RUNNER_PHASE_PENDING_CLASS = 'rq-phase-pending';

/**
 * Sätter starttiden på varje löparprick i `loader` så att de följer klockan, och ger antalet `rqOrbit`-animationer som fanns (0 om stilen inte är tillämpad än eller
 * webbläsaren saknar Web Animations). Kroppen får inte referera till något utanför funktionen (utom webbläsarens egna objekt): `runnerPhaseScript` skriver ut
 * funktionens text som inline-skript. Prickar som inte går runt för alltid lämnas men räknas: `prefers-reduced-motion` ger ett varv på 0,01 ms (index.css), och en sådan
 * animation ska vara som förut.
 */
export function alignRunnersWithClock(loader: Element, timeOrigin: number): number {
  if (typeof loader.getAnimations !== 'function') return 0;
  let found = 0;
  loader.getAnimations({ subtree: true }).forEach((animation) => {
    if ((animation as CSSAnimation).animationName !== 'rqOrbit') return;
    found += 1;
    const timing = animation.effect ? animation.effect.getComputedTiming() : null;
    const lapMs = timing ? Number(timing.duration) : 0;
    if (timing && timing.iterations === Infinity && lapMs > 0) animation.startTime = -(timeOrigin % lapMs);
  });
  return found;
}

/** Refen på laddarens rot: körs när noden satts in i DOM:en, före första målningen, och aldrig på servern (där markupen bara skrivs ut). */
export function alignRunnersOnMount(loader: Element | null): void {
  if (!loader) return;
  alignRunnersWithClock(loader, performance.timeOrigin);
  // Appens första rendering ersätter index.html:s laddare: skriptets väntan på sin fas är då över.
  document.documentElement.classList.remove(RUNNER_PHASE_PENDING_CLASS);
}

/**
 * Texten i inline-skriptet som står i `<head>` i index.html, före stilmallen (prerender-landing). Det körs före all bundlad JS och lägger prickarna på klockan innan
 * första bilden, så att den förrenderade laddaren ligger rätt från början.
 *
 * En animation finns först när både noden och stilmallen finns, i vilken ordning de än kommer, och ritningen kan släppas direkt efter den andra. Skriptet rättar därför
 * vid båda: när parsern satt in en nod (MutationObserver) och när en stilmall är laddad (`load` i fångstfasen). Det räcker inte ensamt: en bildruta kan ändå hinna
 * mellan stilmallens färdigställande och händelsen, med pricken på sin egen nolla (provat: ett fall av trettio). Därför döljer temafilen prickarna (`visibility`) så länge
 * `<html>` bär klassen `rq-phase-pending`, som skriptet sätter först av allt och tar bort när varje prick i en laddare är lagd på klockan (eller vid DOMContentLoaded, så att
 * en laddare som inte går att rätta ändå syns). Det står i head och väntar inte på stilmallen: ett skript i kroppen som väntar på den släpps först i en senare uppgift, och
 * laddaren fick då heller inte finnas i DOM:en före stilen (e2e-proven med fördröjda stilmallar). Ett `animationstart`-lyssnande provades och räckte inte: händelsen skickas
 * först i bildrutan efter den där animationen börjat. Utan Web Animations gör skriptet ingenting.
 *
 * Funktionens text kommer ur `alignRunnersWithClock` självt, så regeln finns på ett ställe; runnerPhase.test.ts kör skriptet. Samma slags skript som sessionstipset
 * (landing-entry/sessionHint.ts): en CSP som införs senare behöver dess sha256-hash (texten är densamma i varje bygge) eller en nonce.
 */
export function runnerPhaseScript(): string {
  const selector = JSON.stringify(RUNNER_PHASE_SELECTOR);
  const pending = JSON.stringify(RUNNER_PHASE_PENDING_CLASS);
  return [
    '(function(){try{',
    'if(typeof Element.prototype.getAnimations!=="function")return;',
    `var d=document.documentElement,f=${alignRunnersWithClock.toString()},`,
    `c=function(){d.classList.remove(${pending})},`,
    // En laddare är klar när antalet rättade animationer är lika med antalet prickar (rotens div-barn).
    `a=function(l){var n=f(l,performance.timeOrigin);if(n&&n===l.querySelectorAll(":scope > div[aria-hidden]").length)c()},`,
    `all=function(){document.querySelectorAll(${selector}).forEach(a)},`,
    'o=new MutationObserver(function(r){r.forEach(function(m){m.addedNodes.forEach(function(n){',
    `var l=n.closest&&n.closest(${selector});`,
    'if(l)a(l)',
    '})})});',
    `d.classList.add(${pending});`,
    'o.observe(document,{childList:true,subtree:true});',
    'document.addEventListener("load",all,true);',
    'document.addEventListener("DOMContentLoaded",function(){o.disconnect();document.removeEventListener("load",all,true);c()})',
    '}catch(e){}})();',
  ].join('');
}
