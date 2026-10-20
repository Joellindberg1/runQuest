import { Navigate } from 'react-router-dom';
import { RoutePending } from './RoutePending';

/**
 * En omdirigering som aldrig lämnar `#root` tom (ADR 006, addendum 2026-10-19, punkt 11). `<Navigate>` renderar null och byter adress i en effekt, och
 * routern byter adress i en övergång: den gamla vyn står kvar tills nästa är redo (en lat sida laddar sin chunk). Är den gamla vyn null är sidan blank under hela
 * tiden. Laddningsvyn bredvid `<Navigate>` fyller den luckan, och den försvinner när målet ritas.
 */
export function PendingNavigate({ to }: { to: string }) {
  return (
    <>
      <Navigate to={to} replace />
      <RoutePending />
    </>
  );
}
