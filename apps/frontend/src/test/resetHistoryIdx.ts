/** Tar bort indexet som HistoryIdx skrev, så att nästa prov i filen börjar utan historik (`window.history.state` delas av alla prov i en fil). */
export const resetHistoryIdx = (): void => {
  window.history.replaceState(null, '');
};
