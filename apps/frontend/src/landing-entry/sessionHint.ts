import { TAB_TARGETS } from '@/app-shell/legacyRedirects';
import { paths } from '@/paths';
import { SESSION_TOKEN_KEY, SESSION_USER_KEY } from '@/shared/services/sessionStorageKeys';

/**
 * Sessionstipset för `<head>` i landing.html (ADR 006, addendum 2026-10-19, punkt 4): texten i ett litet inline-skript som körs före första ritning och
 * skickar en inloggad besökare till appen, så att den förrenderade landningen aldrig målas för någon som redan är inne. Bygget (scripts/prerender-landing.mjs)
 * bäddar in texten där markören `<!--app-session-hint-->` står; ingen bundlad JS behövs, skriptet körs före allt.
 *
 * Villkoret är `backendApi.isAuthenticated()`: båda nycklarna (SESSION_TOKEN_KEY, SESSION_USER_KEY) finns och är inte tomma. Blockerad lagring eller en
 * nyckel som saknas gör ingenting (try/catch). Målet är det `resolveLegacyRedirect` ger för adressens fråga: gamla `?tab=` blir sin nya route, övriga
 * parametrar bevaras, fragmentet tappas som i `pages/Index`, annars /board. Det är alltid en sökväg på den här originen och aldrig en landningsadress
 * (`signedInTarget`, `isLandingAddress`), så ingen öppen omdirigering och ingen loop. Flik-tabellen är den routern använder (`TAB_TARGETS`), inte en kopia.
 *
 * Skriptet speglar `resolveLegacyRedirect` men kan inte importera den. `sessionHint.test.ts` kör det mot en tabell av adresser och kräver samma mål som
 * `resolveLegacyRedirect` och `signedInTarget`, så de två inte kan glida isär utan att testet fäller.
 */
export function sessionHintScript(): string {
  const tabs = JSON.stringify(TAB_TARGETS).replace(/</g, '\\u003c');
  return [
    '(function(){try{',
    `var t=localStorage.getItem(${JSON.stringify(SESSION_TOKEN_KEY)}),u=localStorage.getItem(${JSON.stringify(SESSION_USER_KEY)});`,
    'if(!t||!u)return;',
    `var p=new URLSearchParams(location.search),k=p.get("tab"),m=${tabs},`,
    `d=k!==null&&Object.prototype.hasOwnProperty.call(m,k)?m[k]:${JSON.stringify(paths.board)},r;`,
    'p.delete("tab");r=p.toString();',
    'location.replace(r?d+"?"+r:d)',
    '}catch(e){}})();',
  ].join('');
}
