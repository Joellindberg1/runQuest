import { useMemo } from 'react';
import { useTitleBoard } from '@/features/titles/hooks/useTitlesQueries';
import { ErrorState } from '@/shared/components/ErrorState';
import { RQIcon } from '@/shared/components/icons';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import type { Chapter } from '../playbookModel';
import { buildTitleRuleRows } from '../titleRules';

const ICON_SIZE = 15;
const SKELETON_ROWS = 4;

/** Kapitlets siffror: etikett, värde i Bebas guld och en valfri notrad. Hjältekortet (guld-kant) som prototypens tabell. */
export function ChapterTable({ table }: { table: NonNullable<Chapter['table']> }) {
  return (
    <section className="rq-card rq-card--hero rq-playbook-table" aria-label={table.label}>
      <p className="rq-label rq-playbook-table__label">{table.label}</p>
      <dl className="rq-hairgrid rq-playbook-rows">
        {table.rows.map((row) => (
          <div key={row.label} className="rq-playbook-row">
            <dt className="rq-playbook-row__label">
              {row.label}
              {row.note && <span className="rq-playbook-row__note">{row.note}</span>}
            </dt>
            <dd className="rq-playbook-row__value">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Ingress och stycken. */
export function ChapterText({ chapter }: { chapter: Chapter }) {
  return (
    <>
      <p className="rq-playbook-lead">{chapter.lead}</p>
      {chapter.paras.map((para) => (
        <p key={para} className="rq-playbook-para">
          {para}
        </p>
      ))}
    </>
  );
}

/** Titlarna ur databasen: namn, regel och låsgräns. Skelett medan de hämtas, felkort med Retry om de inte går att läsa. */
export function TitleList() {
  const board = useTitleBoard();
  const rows = useMemo(() => (board.data ? buildTitleRuleRows(board.data) : []), [board.data]);

  if (board.isError && !board.data) {
    return (
      <ErrorState
        title="Couldn't load the titles"
        message="The rules above are right — we just could not read the title list. Try again in a moment."
        retrying={board.isFetching}
        onRetry={() => void board.refetch()}
      />
    );
  }
  if (!board.data) return <SkeletonRows rows={SKELETON_ROWS} label="Loading titles" />;

  return (
    <section className="rq-playbook-titles" aria-labelledby="playbook-titles-heading">
      <h3 id="playbook-titles-heading" className="rq-title rq-playbook-titles__title">
        All titles · {rows.length}
      </h3>
      {rows.length === 0 ? (
        <p className="rq-playbook-empty">No titles are in play yet.</p>
      ) : (
        <ul className="rq-hairgrid rq-playbook-titles__list">
          {rows.map((row) => (
            <li key={row.id} className="rq-playbook-title">
              <span className="rq-name rq-playbook-title__name">
                <RQIcon name={row.icon} size={ICON_SIZE} />
                {row.name}
              </span>
              <span className="rq-playbook-title__rule">{row.rule}</span>
              {row.unlock && <span className="rq-playbook-title__unlock">{row.unlock}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
