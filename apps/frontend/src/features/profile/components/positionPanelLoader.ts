/**
 * Hämtar Position-panelens chunk. Panelen (hook, vymodell, texter) är en egen chunk så att den inte väger i profilens ingångsbunt, och laddaren bor här, i en egen liten modul, så att den som vill
 * förladda chunken (flikens pekare och fokus) inte behöver importera panelen statiskt. Importen är cachad av webbläsaren: ett andra anrop är gratis.
 */
export const loadPositionPanel = () => import('./PositionPanel').then(({ PositionPanel }) => ({ default: PositionPanel }));
