import React from 'react';
import { useLocation } from 'react-router-dom';

/** Gör aktuell adress läsbar i tester: <div data-testid="location">/path?query</div>. */
export const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
};
