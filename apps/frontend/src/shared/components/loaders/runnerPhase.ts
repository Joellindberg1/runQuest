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

/** Klassen på `<html>` medan den förrenderade laddarens prickar väntar på sin fas: `app-shell/shell-pending.css` döljer dem så länge, så ingen bildruta visar en prick på sin egen nolla. */
export const RUNNER_PHASE_PENDING_CLASS = 'rq-phase-pending';

/**
 * Sätter starttiden på varje löparprick i `loader` så att de följer klockan, och ger antalet `rqOrbit`-animationer som fanns (0 om stilen inte är tillämpad än eller
 * webbläsaren saknar Web Animations). Kroppen får inte referera till något utanför funktionen (utom webbläsarens egna objekt): `runnerPhaseScript` skriver ut
 * funktionens text som inline-skript. Prickar som inte går runt för alltid lämnas men räknas: `prefers-reduced-motion` ger ett varv på 0,01 ms (index.css), och en sådan
 * animation ska vara som förut.
 */
export function alignRunnersWithClock(loader: Element, timeOrigin: number): number {
  let found = 0;
  // Fasen är en förbättring av en laddare som redan snurrar: en webbläsare som kastar här (getAnimations, en starttid den vägrar) ska ge en laddare utan fas, aldrig ett undantag
  // i en ref utan felgräns (vit sida) eller i en observatör. En tidslinje utan användbar klocka (timeOrigin saknas) sätter ingen starttid alls (NaN kastar).
  try {
    if (typeof loader.getAnimations !== 'function') return 0;
    const clock = Number.isFinite(timeOrigin);
    loader.getAnimations({ subtree: true }).forEach((animation) => {
      if ((animation as CSSAnimation).animationName !== 'rqOrbit') return;
      found += 1;
      const timing = animation.effect ? animation.effect.getComputedTiming() : null;
      const lapMs = timing ? Number(timing.duration) : 0;
      if (clock && timing && timing.iterations === Infinity && lapMs > 0) animation.startTime = -(timeOrigin % lapMs);
    });
  } catch {
    // Se ovan: laddaren behåller sin egen fas.
  }
  return found;
}

/** Refen på laddarens rot: körs när noden satts in i DOM:en, före första målningen, och aldrig på servern (där markupen bara skrivs ut). Kastar aldrig (ingen felgräns runt refar). */
export function alignRunnersOnMount(loader: Element | null): void {
  if (!loader) return;
  try {
    alignRunnersWithClock(loader, performance.timeOrigin);
    // Appens första rendering ersätter index.html:s laddare: skriptets väntan på sin fas är då över.
    document.documentElement.classList.remove(RUNNER_PHASE_PENDING_CLASS);
  } catch {
    // Laddaren ritas ändå, med sin egen fas.
  }
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
 * först i bildrutan efter den där animationen börjat. Utan Web Animations, och med minskad rörelse (prickarnas animationer har då redan tagit slut och finns inte i
 * `getAnimations`, så "alla prickar rättade" kunde aldrig inträffa), gör skriptet ingenting och döljer ingenting. Varje laddare rättas högst en gång per omgång inkomna noder
 * och aldrig igen när den ligger rätt (varje `getAnimations` tvingar en stilberäkning). Skriptet och refen kastar aldrig.
 *
 * Funktionens text kommer ur `alignRunnersWithClock` självt, så regeln finns på ett ställe; runnerPhase.test.ts kör skriptet. Samma slags skript som sessionstipset
 * (landing-entry/sessionHint.ts): en CSP som införs senare behöver dess sha256-hash (texten är densamma i varje bygge) eller en nonce.
 */
export function runnerPhaseScript(): string {
  const selector = JSON.stringify(RUNNER_PHASE_SELECTOR);
  const pending = JSON.stringify(RUNNER_PHASE_PENDING_CLASS);
  return [
    '(function(){try{',
    // Med minskad rörelse har prickarnas animationer redan tagit slut (en iteration på 0,01 ms) och finns inte i getAnimations: det finns ingen fas att vänta på, så ingenting döljs.
    'if(typeof Element.prototype.getAnimations!=="function"||(typeof matchMedia==="function"&&matchMedia("(prefers-reduced-motion: reduce)").matches))return;',
    `var d=document.documentElement,f=${alignRunnersWithClock.toString()},s=new WeakSet(),`,
    `c=function(){d.classList.remove(${pending})},`,
    // En laddare är klar när antalet rättade animationer är lika med antalet prickar (rotens div-barn), och rättas då inte igen (varje getAnimations tvingar en stilberäkning).
    `a=function(l){if(s.has(l))return;try{var n=f(l,performance.timeOrigin);if(n&&n===l.querySelectorAll(":scope > div[aria-hidden]").length){s.add(l);c()}}catch(e){}},`,
    `all=function(){document.querySelectorAll(${selector}).forEach(a)},`,
    // En gång per laddare och omgång noder, inte en gång per tillagd nod.
    'o=new MutationObserver(function(r){try{var u=[];r.forEach(function(m){m.addedNodes.forEach(function(n){',
    `var l=n.closest&&n.closest(${selector});`,
    'if(l&&u.indexOf(l)<0)u.push(l)',
    '})});u.forEach(a)}catch(e){}});',
    `d.classList.add(${pending});`,
    'o.observe(document,{childList:true,subtree:true});',
    'document.addEventListener("load",all,true);',
    'document.addEventListener("DOMContentLoaded",function(){o.disconnect();document.removeEventListener("load",all,true);c()})',
    '}catch(e){}})();',
  ].join('');
}
