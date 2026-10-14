import { NotificationSettingsPanel } from '@/features/settings/components/NotificationSettingsPanel';
import { NewsSettingsNote } from './NewsSettingsNote';

/**
 * Notisinställningarna som kort i sidokolumnen på desktop, under filtret (frame N1). Ankaret `news-settings` ligger på kortets
 * omslag och turen (S23) pekar dit. Kolumnen är smal (300 px), så sektionerna börjar hopfällda och totalsumman utelämnas.
 * Monteras bara på desktop: bladet på mobil är den andra instansen, och de finns aldrig samtidigt (en panel = en live-region av varje slag).
 */
export function NewsSettingsColumn() {
  return (
    <>
      <div className="rq-news-settings" data-tour="news-settings">
        <NotificationSettingsPanel headingLevel={2} defaultExpanded={false} showTotal={false} className="rq-card rq-notify--side" />
      </div>
      <NewsSettingsNote />
    </>
  );
}
