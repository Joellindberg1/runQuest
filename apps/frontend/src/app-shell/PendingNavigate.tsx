import { Navigate } from 'react-router-dom';
import { RoutePending } from './RoutePending';

/**
 * En omdirigering som aldrig lämnar `#root` tom (ADR 006, addendum 2026-10-19, punkt 11). `<Navigate>` renderar null och byter adress i en effekt, och medan målets
 * lata sida laddar sin chunk finns inget annat att visa: är `<Navigate>` det enda som ritas är sidan blank under hela tiden (routern använder inte React.startTransition,
 * ADR 006 addendum 2026-10-25, så den gamla vyn står inte kvar).
 * Laddningsvyn bredvid `<Navigate>` fyller den luckan, och den försvinner när målet ritas.
 */
export function PendingNavigate({ to }: { to: string }) {
  return (
    <>
      <Navigate to={to} replace />
      <RoutePending />
    </>
  );
}
