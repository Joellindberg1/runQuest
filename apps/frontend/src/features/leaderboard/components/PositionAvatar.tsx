import { useState } from 'react';

interface PositionAvatarProps {
  initials: string;
  pictureUrl: string | null;
}

/**
 * Löparens profilbild i en cirkel, eller initialerna när bilden saknas eller inte går att hämta. Ren dekor (aria-hidden): namnet och placeringen
 * står som text bredvid. Storleken sätts av omgivningen (grafens slutpunkt, raden i "Current order"), ringen av data-me/data-selected på en förälder.
 * En trasig bild minns vilken URL som föll, så en ny bild får ett nytt försök.
 */
export function PositionAvatar({ initials, pictureUrl }: PositionAvatarProps) {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const showPicture = pictureUrl !== null && pictureUrl !== brokenUrl;
  return (
    <span className="rq-board-position-avatar" aria-hidden="true">
      {showPicture ? <img src={pictureUrl} alt="" onError={() => setBrokenUrl(pictureUrl)} /> : initials}
    </span>
  );
}
