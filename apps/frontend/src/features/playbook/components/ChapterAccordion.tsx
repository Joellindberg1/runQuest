import { RQIcon } from '@/shared/components/icons';
import type { Chapter, ChapterId } from '../playbookModel';
import { ChapterTable, ChapterText, TitleList } from './ChapterParts';

const ICON_SIZE = 17;
const CHEVRON_SIZE = 15;

interface ChapterAccordionProps {
  chapters: readonly Chapter[];
  /** Kapitlet som är öppet; null = alla hopfällda. */
  openId: ChapterId | null;
  onToggle: (id: ChapterId) => void;
}

/**
 * Mobilens Playbook: nio rader (nummer · ikon · namn · pil) som fäller ut ett kapitel i taget, så alla nio titlar ryms på
 * en skärm (App Prototypens mPlaybook). Öppen rad = guld-tint och guld vänsterkant. Riktiga knappar med aria-expanded.
 */
export function ChapterAccordion({ chapters, openId, onToggle }: ChapterAccordionProps) {
  return (
    <ol className="rq-hairgrid rq-playbook-acc">
      {chapters.map((chapter) => {
        const open = chapter.id === openId;
        const buttonId = `playbook-acc-${chapter.id}`;
        const panelId = `playbook-acc-panel-${chapter.id}`;
        return (
          <li key={chapter.id} className="rq-playbook-acc__item">
            <h2 className="rq-playbook-acc__heading">
              <button type="button" id={buttonId} className="rq-playbook-acc__button" aria-expanded={open} aria-controls={panelId} onClick={() => onToggle(chapter.id)}>
                <span className="rq-playbook-acc__num">{chapter.num}</span>
                <RQIcon name={chapter.icon} size={ICON_SIZE} />
                <span className="rq-playbook-acc__label">{chapter.label}</span>
                <RQIcon name="chevron" size={CHEVRON_SIZE} className="rq-playbook-acc__chevron" />
              </button>
            </h2>
            {open && (
              <div id={panelId} role="region" aria-labelledby={buttonId} className="rq-playbook-acc__body">
                <ChapterText chapter={chapter} />
                {chapter.table && <ChapterTable table={chapter.table} />}
                {chapter.showsTitleList && <TitleList />}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
