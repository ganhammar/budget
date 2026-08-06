import type { ReactNode } from 'react';
import { useWidth, usePointerIndex } from './chart';
import type { DebtPoint } from '../domain/engine';
import type { Loan } from '../domain/types';
import { sek } from '../domain/format';
import { formatMonth, formatMonthShort } from '../domain/month';
import { useText } from '../i18n';

// Right margin holds the direct labels: identity comes from the name at the end
// of each line, not from its shade.
const MARGIN = { top: 12, right: 62, bottom: 22, left: 46 };
const HEIGHT = 210;

/**
 * Ink ramp rather than hues. Identity comes from the label at each line's end, so
 * the shade is only there to keep neighbouring lines apart. Validated monotone
 * against both papers.
 */
export function seriesColor(index: number): string {
  return `var(--ink-${(index % 6) + 1})`;
}

export interface SeriesPoint {
  month: string;
  /** One figure per loan id. */
  values: Record<string, number>;
}

interface ChartProps {
  points: SeriesPoint[];
  /** Only the loans to draw. */
  loans: Loan[];
  /**
   * Loan id to ramp step, keyed off the full loan list rather than the visible
   * one. Hiding a loan must not re-shade the ones that remain.
   */
  colorIndex: Record<string, number>;
  /** One line per loan, or a single line of their sum. */
  split: boolean;
  /** Name for the combined line, which has no loan of its own. */
  combinedLabel: string;
  /** Axis ticks; the y scale differs by an order of magnitude between series. */
  formatTick: (value: number) => string;
  ariaLabel: string;
  /** Legend or hint shown under the chart when nothing is selected. */
  footer: ReactNode;
}

/**
 * One line per loan or one for the lot, over whatever months it is handed. Used
 * for both debt and interest: the two differ only in the figures, the scale and
 * what the footer says.
 */
export function SeriesChart({
  points,
  loans,
  colorIndex,
  split,
  combinedLabel,
  formatTick,
  ariaLabel,
  footer,
}: ChartProps) {
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

  if (points.length < 2 || loans.length === 0) return null;

  const sumAt = (point: SeriesPoint) =>
    loans.reduce((sum, loan) => sum + (point.values[loan.id] ?? 0), 0);

  // Split draws each loan against a shared scale, so a small loan is still a
  // visible trajectory rather than a sliver of a stack.
  const lines = split
    ? loans.map((loan) => ({
        key: loan.id,
        label: loan.description,
        color: seriesColor(colorIndex[loan.id] ?? 0),
        values: points.map((p) => p.values[loan.id] ?? 0),
      }))
    : [
        {
          key: 'combined',
          label: combinedLabel,
          color: seriesColor(0),
          values: points.map(sumAt),
        },
      ];

  const max = Math.max(1, ...lines.flatMap((line) => line.values));

  const x = (i: number) => MARGIN.left + (i * plotW) / (points.length - 1);
  const y = (v: number) => MARGIN.top + plotH - (v / max) * plotH;

  const dotStep = Math.max(1, Math.ceil(points.length / Math.max(3, Math.floor(plotW / 34))));
  const labelStep = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 46))));

  const series = lines.map((line) => ({
    ...line,
    path: line.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' '),
    endValue: line.values[line.values.length - 1],
  }));

  // Label the lines that still exist at the right edge, skipping any that would sit
  // on top of one already placed. Lines that have fallen to zero sit on the axis,
  // where a label would collide and say nothing the footer does not already.
  const placed: number[] = [];
  const labels = [...series]
    .filter((s) => s.endValue > 0.005)
    .sort((a, b) => b.endValue - a.endValue)
    .map((s) => {
      const ly = y(s.endValue);
      const collides = placed.some((p) => Math.abs(p - ly) < 11);
      if (!collides) placed.push(ly);
      return { ...s, ly, show: !collides };
    })
    .filter((s) => s.show);

  const selected = active === null ? null : points[active];
  const shown = selected ?? points[0];

  return (
    <div ref={ref}>
      <svg
        className="chart"
        width="100%"
        height={HEIGHT}
        viewBox={`0 0 ${w} ${HEIGHT}`}
        {...handlers}
        role="img"
        aria-label={ariaLabel}
      >
        {[max, max / 2, 0].map((v) => (
          <g key={v}>
            <line className="gridline" x1={MARGIN.left} x2={w - MARGIN.right} y1={y(v)} y2={y(v)} />
            <text className="tick" x={MARGIN.left - 7} y={y(v) + 3} textAnchor="end">
              {formatTick(v)}
            </text>
          </g>
        ))}

        {series.map(({ key, path, color }) => (
          <path key={key} className="line" d={path} style={{ stroke: color }} />
        ))}

        {series.map(({ key, values, color }) =>
          values.map((v, i) =>
            i % dotStep === 0 ? (
              <circle
                key={`${key}-${i}`}
                className="dot"
                cx={x(i)}
                cy={y(v)}
                r={2.2}
                style={{ stroke: color }}
              />
            ) : null,
          ),
        )}

        {labels.map(({ key, label, ly, color }) => (
          <text
            key={key}
            className="series-label"
            x={w - MARGIN.right + 6}
            y={ly + 3}
            style={{ fill: color }}
          >
            {label}
          </text>
        ))}

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
            {series.map(({ key, values, color }) => (
              <circle
                key={key}
                className="marker"
                cx={x(active)}
                cy={y(values[active])}
                r={3.4}
                style={{ fill: color }}
              />
            ))}
          </>
        )}
      </svg>

      {/* Both layers always render so the box never resizes on hover. */}
      <div className="chart-detail">
        <div className="detail-layer" data-hidden={selected === null} aria-hidden={selected === null}>
          <div className="tooltip-month">{formatMonth(shown.month)}</div>
          {/* The breakdown is worth having even when the chart draws one line. */}
          {loans.map((loan) => (
            <div className="tooltip-row" key={loan.id}>
              <span>{loan.description}</span>
              <span>{sek(shown.values[loan.id] ?? 0)}</span>
            </div>
          ))}
          <div className="tooltip-row total">
            <span>{t.total}</span>
            <strong>{sek(sumAt(shown))}</strong>
          </div>
        </div>

        <div className="detail-layer" data-hidden={selected !== null} aria-hidden={selected !== null}>
          {footer}
        </div>
      </div>
    </div>
  );
}

export function DebtTable({ points, loans }: { points: DebtPoint[]; loans: Loan[] }) {
  const t = useText();
  // One row per year keeps this readable over a payoff that runs for decades.
  const yearly = points.filter((p, i) => i === 0 || p.month.endsWith('-01'));

  return (
    <div className="scroll-x">
      <table className="table">
        <thead>
          <tr>
            <th>{t.monthLabel}</th>
            {loans.map((l) => (
              <th key={l.id}>{l.description}</th>
            ))}
            <th>{t.total}</th>
          </tr>
        </thead>
        <tbody>
          {yearly.map((p) => (
            <tr key={p.month}>
              <td>{formatMonthShort(p.month)}</td>
              {loans.map((l) => (
                <td key={l.id}>{sek(p.debts[l.id] ?? 0)}</td>
              ))}
              <td>
                <strong>{sek(loans.reduce((s, l) => s + (p.debts[l.id] ?? 0), 0))}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
