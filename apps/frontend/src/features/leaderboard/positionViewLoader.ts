/**
 * Hämtar Position-vyns chunk. Vyn (grafen, "Current order", tabellen och deras stil) är en egen chunk så att den inte väger i Boards ingångsbunt, och laddaren bor här, i en
 * egen liten modul, så att den som vill förladda chunken (flikens pekare och fokus) inte behöver importera vyn statiskt. Importen är cachad av webbläsaren: ett andra
 * anrop är gratis.
 */
export const loadPositionView = () => import('./components/PositionView').then(({ PositionView }) => ({ default: PositionView }));
