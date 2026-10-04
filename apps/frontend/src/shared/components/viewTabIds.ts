/** id:n som kopplar ViewTabs-flikarna till sin tabpanel (aria-controls / aria-labelledby). */
export const tabId = (idPrefix: string, key: string) => `${idPrefix}-tab-${key}`;
export const panelId = (idPrefix: string) => `${idPrefix}-panel`;
