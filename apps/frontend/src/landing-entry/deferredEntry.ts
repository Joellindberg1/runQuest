/**
 * Boot-skriptet som landing.html laddar i stället för ingångsmodulen (RUN-343). Landningen är färdigritad i HTML:en och behöver ingen JS för att synas, så
 * ingångsmodulen och dess förladdningar hämtas först när första innehållsritningen (`first-contentful-paint`) har skett. Annars delar de ~126 kB JS bandbredd med
 * stilmallarna, typsnittet och mobilpostern fram till första ritningen: Lighthouses simulerade 4G ger då render delay i sekunder, trots att JS:et inte ritar något.
 * Bygget (`deferLandingEntry.ts`) tar ur HTML-filen modulskriptet och alla `modulepreload`-länkar och skriver texten härifrån till en liten fil som läggs i deras ställe.
 *
 * Skriptet är en separat fil och inget inline-skript, så en framtida CSP behöver ingen hash för det och `landing.html` har kvar exakt två inline-skript.
 *
 * - Start: första `first-contentful-paint`. Observern ber om redan gjorda ritningar (`buffered`), så en ritning före skriptet inte missas.
 * - Utan ritningsmätning (äldre webbläsare): nästa bildruta, sedan nästa uppgift. Utan bildrutor också: tidsgränsen.
 * - Tidsgränsen (`ENTRY_START_TIMEOUT_MS`) startar ändå om ingen ritning kommer, till exempel i en flik som öppnats i bakgrunden där ritningen väntar tills fliken visas.
 * - Start sker en gång. Förladdningarna läggs före modulen och har samma `crossorigin` som taggarna Vite skrev.
 *
 * Hydreringen ändrar inget i DOM:en (klientens första rendering är identisk med serverns), så att den kommer en bildruta senare syns inte; formuläret är `inert`
 * tills dess (README, "Väntelistans formulär").
 */
export const ENTRY_START_TIMEOUT_MS = 1500;

export interface DeferredEntry {
  /** Adressen till ingångsmodulen, som den stod i Vites modulskript. */
  entry: string;
  /** Adresserna i Vites `modulepreload`-länkar, i dokumentets ordning. */
  preloads: string[];
}

/** Läggs i JSON:en så att en adress med `<` aldrig kan avsluta ett skriptelement om texten en dag bäddas in i HTML. */
const literal = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

export function deferredEntryScript({ entry, preloads }: DeferredEntry): string {
  return [
    '(function(){',
    'var started=false;',
    'function start(){',
    'if(started)return;started=true;',
    'var head=document.head,urls=' + literal(preloads) + ',i,link,script;',
    'for(i=0;i<urls.length;i++){link=document.createElement("link");link.rel="modulepreload";link.setAttribute("crossorigin","");link.href=urls[i];head.appendChild(link)}',
    'script=document.createElement("script");script.type="module";script.setAttribute("crossorigin","");script.src=' + literal(entry) + ';head.appendChild(script)',
    '}',
    'try{',
    'new PerformanceObserver(function(list){if(list.getEntriesByName("first-contentful-paint").length>0)start()}).observe({type:"paint",buffered:true})',
    '}catch(e){',
    'if(typeof requestAnimationFrame==="function")requestAnimationFrame(function(){setTimeout(start,0)})',
    '}',
    `setTimeout(start,${ENTRY_START_TIMEOUT_MS})`,
    '})();',
  ].join('');
}
