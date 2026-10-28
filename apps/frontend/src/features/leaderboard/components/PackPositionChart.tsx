import { cssVars } from '../cssVars';
import { CURRENT_WEEK_PHRASE } from '../positionTexts';
import { weekTickIndexes } from '../positionWeekTicks';
import type { ChartLine, ChartPoint, PositionChartModel } from '../positionChartModel';
import { PositionAvatar } from './PositionAvatar';

// Leaderboardens positionsgraf för alla löpare (Position-fliken): en handritad SVG utan diagramlib. Allt som ska sägas och räknas kommer ur vymodellen
// (positionChartModel); här ritas bara. Varje linje är en egen SVG som sträcks över fältet (viewBox 0–100 i x, px i y, non-scaling-stroke) och prickarna,
// den ihåliga punkten och bilden är HTML ovanpå, så att de behåller sin storlek i alla bredder. Linjerna ligger i modellens ritordning (din och den valda
// överst). Färg och tjocklek kommer av data-me/data-selected/data-dimmed i stilen: ingen färg per löpare. Ingenting animeras.
// Skärmläsaren får EN mening (role="img") ur modellen; ytan, axeltalen, namnen och veckoetiketterna är aria-hidden.
//
// Komponenten laddas lazy av fliken (React.lazy, dynamisk import) och ligger därför aldrig i landningens eller ingångens bunt.

/** viewBox-bredden: x ritas i 0–100 och sträcks till fältet; y är px. */
const SVG_WIDTH = 100;
const FRACTION_DIGITS = 4;

const px = (value: number) => `${value}px`;
const fractionOf = (x: number) => String(Number(x.toFixed(FRACTION_DIGITS)));
const svgX = (x: number) => Number((x * SVG_WIDTH).toFixed(FRACTION_DIGITS));
const pointVars = (point: ChartPoint) => cssVars({ '--x': fractionOf(point.x), '--y': px(point.y) });

const stateOf = (line: Pick<ChartLine, 'isMe' | 'selected' | 'dimmed'>) =>
  ({ 'data-me': String(line.isMe), 'data-selected': String(line.selected), 'data-dimmed': String(line.dimmed) }) as const;

function PackLine({ line, height }: { line: ChartLine; height: number }) {
  const finished = line.points.filter((point) => point.kind !== 'hollow');
  const hollow = line.points.find((point) => point.kind === 'hollow');
  const lastFinished = finished.at(-1);
  return (
    <span className="rq-board-position__line" data-line={line.id} {...stateOf(line)}>
      <svg className="rq-board-position__svg" viewBox={`0 0 ${SVG_WIDTH} ${height}`} preserveAspectRatio="none" focusable="false" aria-hidden="true">
        {finished.length > 1 && <polyline className="rq-board-position__stroke" points={finished.map((point) => `${svgX(point.x)},${point.y}`).join(' ')} />}
        {lastFinished && hollow && (
          <line className="rq-board-position__dash" x1={svgX(lastFinished.x)} y1={lastFinished.y} x2={svgX(hollow.x)} y2={hollow.y} />
        )}
      </svg>
      {line.points.map((point) => point.kind === 'dot' && <span key={point.weekIndex} className="rq-board-position__dot" style={pointVars(point)} />)}
      {hollow && <span className="rq-board-position__hollow" style={pointVars(hollow)} />}
      {line.endpoint && (
        <span className="rq-board-position__endpoint" style={pointVars(line.endpoint)}>
          <PositionAvatar initials={line.endpoint.initials} pictureUrl={line.endpoint.pictureUrl} />
        </span>
      )}
    </span>
  );
}

/** Grafen och legenden under den. `hidden` och `no-finished-week` ritar ingenting här: kortet förklarar dem. */
export function PackPositionChart({ model }: { model: PositionChartModel }) {
  if (model.mode !== 'chart') return null;
  const { geometry, gridRows, lines, weeks } = model;
  const byId = new Map(lines.map((line) => [line.id, line]));
  const current = weeks[weeks.length - 1];

  return (
    <>
      <div
        className="rq-board-position__chart"
        role="img"
        aria-label={model.ariaLabel}
        style={cssVars({
          '--rq-board-position-h': px(geometry.height),
          '--rq-board-position-row': px(geometry.rowHeight),
          '--rq-board-position-pad': px(geometry.padding),
          '--rq-board-position-n': String(gridRows.length),
        })}
      >
        <div className="rq-board-position__axis" aria-hidden="true">
          {gridRows.map((row) => (
            <span key={row.position} className="rq-board-position__axis-num" style={cssVars({ '--y': px(row.y) })}>
              {row.position}
            </span>
          ))}
        </div>

        <div className="rq-board-position__field" aria-hidden="true">
          {gridRows.map((row) => (
            <span key={row.position} className="rq-board-position__grid" style={cssVars({ '--y': px(row.y) })} />
          ))}
          <div className="rq-board-position__lines">
            {model.paintOrder.map((id) => {
              const line = byId.get(id);
              return line && <PackLine key={id} line={line} height={geometry.height} />;
            })}
          </div>
        </div>

        <div className="rq-board-position__names" aria-hidden="true">
          {lines.map(
            (line) =>
              line.position !== null && (
                <span key={line.id} className="rq-board-position__name" data-line={line.id} {...stateOf(line)} style={cssVars({ '--p': String(line.position) })}>
                  {line.label}
                </span>
              ),
          )}
        </div>

        <div className="rq-board-position__weeks" aria-hidden="true">
          <div className="rq-board-position__weeks-field">
            {weekTickIndexes(weeks.length).map((index) => (
              <span key={index} className="rq-board-position__week" data-current={String(weeks[index].isCurrent)} style={cssVars({ '--x': fractionOf(weeks[index].x) })}>
                {weeks[index].visual}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Dold för skärmläsare: bildens text säger redan att veckan pågår. */}
      <p className="rq-board-position__legend" aria-hidden="true">
        <span className="rq-board-position__swatch" />
        <span>{`${current.visual} · ${CURRENT_WEEK_PHRASE}`}</span>
      </p>
    </>
  );
}
