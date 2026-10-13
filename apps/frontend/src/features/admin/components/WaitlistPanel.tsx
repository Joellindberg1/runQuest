import { ErrorState } from '@/shared/components/ErrorState';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import { useAdminWaitlist } from '../hooks/useAdminWaitlist';
import { shownLimitText, signupCountText, signupDateText } from '../waitlistModel';

const SKELETON_ROWS = 4;

/**
 * Väntelistan, nyast först: antalet i rubriken, en rad per anmälan (e-post · datum) som hårlinjegrid och, när listan är kapad,
 * en rad om hur många som visas. Bara läsning — ingen åtgärd på raderna (radering och inbjudan kommer senare).
 */
export function WaitlistPanel() {
  const waitlist = useAdminWaitlist();
  const data = waitlist.data;

  let list;
  if (data) {
    const limitText = shownLimitText(data.entries.length, data.total);
    list =
      data.entries.length === 0 ? (
        <p className="rq-admin-empty">No one has joined the waitlist yet.</p>
      ) : (
        <>
          <ul className="rq-hairgrid rq-admin-signups" aria-label="Waitlist">
            {data.entries.map((signup) => (
              <li key={signup.id} className="rq-admin-signup">
                <span className="rq-admin-signup__email">{signup.email}</span>
                <span className="rq-admin-signup__date">{signupDateText(signup.created_at)}</span>
              </li>
            ))}
          </ul>
          {limitText && <p className="rq-admin-card__note">{limitText}</p>}
        </>
      );
  } else if (waitlist.isError) {
    list = (
      <ErrorState
        title="Couldn't load the waitlist"
        message="Nothing was changed — we just could not read the list. Try again in a moment."
        retrying={waitlist.isFetching}
        onRetry={() => void waitlist.refetch()}
      />
    );
  } else {
    list = <SkeletonRows rows={SKELETON_ROWS} label="Loading the waitlist" />;
  }

  return (
    <section className="rq-card rq-admin-card" aria-labelledby="admin-waitlist-title">
      <div className="rq-admin-card__head">
        <h2 id="admin-waitlist-title" className="rq-title rq-admin-card__title">Waitlist</h2>
        {data && (
          <div className="rq-admin-card__aside">
            <span>{signupCountText(data.total)}</span>
          </div>
        )}
      </div>
      {list}
    </section>
  );
}
