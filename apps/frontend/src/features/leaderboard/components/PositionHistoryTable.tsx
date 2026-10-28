import type { PositionTableModel } from '../positionChartModel';

// Samma data som grafen som en tabell ("Show as table"): en rad per löpare med fullt namn, en kolumn per vecka. Texterna kommer ur modellen
// (captionen, veckornas talade form, tankstrecket och dess fotnot); här ritas bara. Veckoetiketterna och tankstrecket är dolda för skärmläsare och
// ersätts av sin talade text ("week 27", "not in the group yet").

export function PositionHistoryTable({ table }: { table: PositionTableModel }) {
  return (
    <>
      <table className="rq-board-position__table">
        <caption className="sr-only">{table.caption}</caption>
        <thead>
          <tr>
            <th scope="col">Runner</th>
            {table.columns.map((column) => (
              <th key={column.weekLabel} scope="col" data-current={String(column.isCurrent)}>
                <span aria-hidden="true">{column.weekLabel}</span>
                <span className="sr-only">{column.spoken}</span>
                {column.isCurrent && <span className="rq-board-position__table-sub">{column.header}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.id}>
              <th scope="row" data-me={String(row.isMe)}>
                {row.name}
                {row.isMe && <span className="sr-only"> (you)</span>}
              </th>
              {row.cells.map((cell, index) => (
                <td key={table.columns[index].weekLabel} data-current={String(cell.isCurrent)} data-empty={String(cell.position === null)}>
                  {cell.position === null ? (
                    <>
                      <span aria-hidden="true">{cell.text}</span>
                      <span className="sr-only">{cell.spokenText}</span>
                    </>
                  ) : (
                    cell.text
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.footnote && <p className="rq-board-position__footnote">{table.footnote}</p>}
    </>
  );
}
