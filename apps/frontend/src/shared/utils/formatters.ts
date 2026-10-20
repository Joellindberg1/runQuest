/** Initialer ur ett fullt namn: förnamnets och efternamnets första bokstav. "Anna Maria Lindqvist" → "AL", ett enda namn ger en bokstav, inget namn ger "?". */
export function getInitials(name: string): string {
  const letters = name.split(/\s+/).filter(Boolean).map((part) => part[0]);
  return (letters.length > 1 ? letters[0] + letters[letters.length - 1] : letters[0] ?? '?').toUpperCase();
}
