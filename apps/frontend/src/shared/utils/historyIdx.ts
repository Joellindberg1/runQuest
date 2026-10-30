/**
 * React Routers plats i webbläsarens historik (`idx` i `history.state`; 0 = första posten), eller null när den inte finns (ett test med MemoryRouter, en historik som inte skrivits av routern).
 * Ett steg bakåt ger ett lägre index än förut, `replace` samma index och en ny post ett högre.
 */
export function historyIdx(): number | null {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' ? idx : null;
}
