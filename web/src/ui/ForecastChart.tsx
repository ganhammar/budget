import { useWidth, usePointerIndex } from './chart';
import type { ForecastPoint } from '../domain/engine';
import { sek } from '../domain/format';
import { formatMonth, formatMonthShort } from '../domain/month';
import { useText } from '../i18n';

const MARGIN = { top: 12, right: 8, bottom: 22, left: 46 };
const HEIGHT = 190;

/** Always this many item rows, so the detail box never changes height. */
const ITEM_SLOTS = [0, 1, 2];

export function ForecastChart({ points }: { points: ForecastPoint[] }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const t = useText();

  // Sizes and the pointer hook come before the early return: hooks cannot run
  // conditionally, and these depend only on the measured width.
  const w = Math.max(width, 280);
  const plotW = w - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;

  const { active, handlers } = usePointerIndex(points.length, (clientX, rect) => {
    const px = ((clientX - rect.left) / rect.width) * w;
    return Math.round(((px - MARGIN.left) / plotW) * (points.length - 1));
  });

  if (points.length < 2) return null;

  const values = points.map((p) => p.closing);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const pad = (rawMax - rawMin) * 0.1 || 1000;
  const min = rawMin - pad;
  const max = rawMax + pad;

  const x = (i: number) => MARGIN.left + (i * plotW) / (points.length - 1);
  const y = (v: number) => MARGIN.top + plotH - ((v - min) / (max - min)) * plotH;

  const zeroY = y(0);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.closing)}`).join(' ');
  const ticks = [max, (max + min) / 2, min];

  // A dot per month is the point of the chart, but at 24 points they collide.
  // Thin them the same way as the axis labels rather than dropping them.
  const dotStep = Math.max(1, Math.ceil(points.length / Math.max(4, Math.floor(plotW / 26))));
  const labelStep = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 46))));

  const selected = active === null ? null : points[active];
  const firstNegative = points.find((p) => p.closing < 0);

  return (
    <div ref={ref}>
      <svg
        className="chart"
        width="100%"
        height={HEIGHT}
        viewBox={`0 0 ${w} ${HEIGHT}`}
        {...handlers}
        role="img"
        aria-label={t.forecastChartLabel}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line className="gridline" x1={MARGIN.left} x2={w - MARGIN.right} y1={y(v)} y2={y(v)} />
            <text className="tick" x={MARGIN.left - 7} y={y(v) + 3} textAnchor="end">
              {Math.round(v / 1000)}k
            </text>
          </g>
        ))}

        <line className="zero-line" x1={MARGIN.left} x2={w - MARGIN.right} y1={zeroY} y2={zeroY} />

        <path className="line" d={line} />

        {points.map((p, i) =>
          i % dotStep === 0 ? (
            <circle
              key={p.month}
              className={`dot ${p.closing < 0 ? 'below' : ''}`}
              cx={x(i)}
              cy={y(p.closing)}
              r={2.6}
            />
          ) : null,
        )}

        {points.map((p, i) =>
          i % labelStep === 0 && i <= points.length - 1 - labelStep / 2 ? (
            <text key={p.month} className="tick" x={x(i)} y={HEIGHT - 7} textAnchor="middle">
              {formatMonthShort(p.month)}
            </text>
          ) : null,
        )}

        {selected && active !== null && (
          <>
            <line
              className="crosshair"
              x1={x(active)}
              x2={x(active)}
              y1={MARGIN.top}
              y2={MARGIN.top + plotH}
            />
            <circle
              className={`marker ${selected.closing < 0 ? 'below' : ''}`}
              cx={x(active)}
              cy={y(selected.closing)}
              r={4}
            />
          </>
        )}
      </svg>

      {/*
        Both layers always render so the box keeps the height of the taller one.
        Anything that resizes on hover moves the chart under the cursor, which
        retriggers the hover, which resizes it again.
      */}
      <div className="chart-detail">
        <div className="detail-layer" data-hidden={selected === null} aria-hidden={selected === null}>
          <div className="tooltip-month">{formatMonth((selected ?? points[0]).month)}</div>
          <div className="tooltip-row">
            <span>{t.balanceAtMonthEnd}</span>
            <strong className={(selected?.closing ?? 0) < 0 ? 'negative' : ''}>
              {sek((selected ?? points[0]).closing)}
            </strong>
          </div>
          <div className="tooltip-row">
            <span>{t.inFromMembers}</span>
            <span>{sek((selected ?? points[0]).inflow)}</span>
          </div>
          <div className="tooltip-row">
            <span>{t.outFromAccount}</span>
            <span>{sek((selected ?? points[0]).outflow)}</span>
          </div>
          {ITEM_SLOTS.map((slot) => {
            const item = (selected ?? points[0]).items[slot];
            return (
              <div className="tooltip-row item" key={slot}>
                <span>{item ? item.label : ' '}</span>
                <span>{item ? sek(item.amount) : ''}</span>
              </div>
            );
          })}
        </div>

        <div className="detail-layer" data-hidden={selected !== null} aria-hidden={selected !== null}>
          <span className="hint">
            {firstNegative
              ? t.goesBelowZero(formatMonth(firstNegative.month))
              : t.staysAboveZero}{' '}
            {t.pointForDetails}
          </span>
        </div>
      </div>
    </div>
  );
}

export function ForecastTable({ points }: { points: ForecastPoint[] }) {
  const t = useText();
  return (
    <div className="scroll-x">
      <table className="table">
        <thead>
          <tr>
            <th>{t.monthLabel}</th>
            <th>{t.opening}</th>
            <th>{t.incomingShort}</th>
            <th>{t.outgoingShort}</th>
            <th>{t.closing}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.month}>
              <td>{formatMonthShort(p.month)}</td>
              <td>{sek(p.opening)}</td>
              <td>{sek(p.inflow)}</td>
              <td>{sek(p.outflow)}</td>
              <td className={p.closing < 0 ? 'negative' : ''}>{sek(p.closing)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
