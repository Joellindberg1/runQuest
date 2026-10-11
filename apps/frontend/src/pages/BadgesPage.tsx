import React from 'react';
import { Link } from 'react-router-dom';
import { paths } from '@/paths';
import { useIsDesktop } from '@/app-shell/useIsDesktop';

/** /badges: sidskalet för badge-samlingen. Innehållet kommer med RUN-150; tills dess bara rubriken och (mobil) vägen tillbaka. */
const BadgesPage: React.FC = () => {
  const isDesktop = useIsDesktop();

  return (
    <div>
      {isDesktop === false && (
        <Link to={paths.profile} className="rq-back">
          <span aria-hidden="true">‹</span>
          <span>Back</span>
        </Link>
      )}
      <h1 className="rq-display">Badges</h1>
    </div>
  );
};

export default BadgesPage;
