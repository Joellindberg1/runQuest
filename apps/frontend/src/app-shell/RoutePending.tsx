import { TrackLoader } from '@/shared/components/loaders/TrackLoader';

/** Suspense-fallback för route-chunkar utanför skalets egen Suspense (landning, preview, själva skalet). Samma bild som App.tsx visar medan sessionen läses. */
export function RoutePending() {
  return (
    <div className="rq-shell__pending">
      <TrackLoader size={64} label="Loading" />
    </div>
  );
}
