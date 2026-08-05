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

interface ChartProps {
  points: DebtPoint[];
  /** Only the loans to draw. */
  loans: Loan[];
  /**
   * Loan id to ramp step, keyed off the full loan list rather than the visible
   * one. Hiding a loan must not re-shade the ones that remain.
   */
  colorIndex: Record<string, number>;
  /** Month each loan clears, or null where nothing amortizes it. */
  payoff: Record<string, string | null>;
}

export function DebtChart({ points, loans, colorIndex, payoff }: ChartProps) {
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

  // Each loan on its own line against a shared scale, so a small loan is still a
  // visible trajectory rather than a sliver of a stack.
  const max = Math.max(1, ...points.flatMap((p) => loans.map((l) => p.debts[l.id] ?? 0)));

  const x = (i: number) => MARGIN.left + (i * plotW) / (points.length - 1);
  const y = (v: number) => MARGIN.top + plotH - (v / max) * plotH;

  const dotStep = Math.max(1, Math.ceil(points.length / Math.max(3, Math.floor(plotW / 34))));
  const labelStep = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 46))));

  const series = loans.map((loan) => {
    const path = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.debts[loan.id] ?? 0)}`)
      .join(' ');
    const endValue = points[points.length - 1].debts[loan.id] ?? 0;
    return { loan, path, endValue };
  });

  // Label the lines that still exist at the right edge, skipping any that would sit
  // on top of one already placed. Loans that have cleared sit flat on zero, where a
  // label would collide with the axis and say nothing the legend does not already.
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
  const total = loans.reduce((sum, l) => sum + (shown.debts[l.id] ?? 0), 0);

  return (
    <div ref={ref}>
      <svg
        className="chart"
        width="100%"
        height={HEIGHT}
        viewBox={`0 0 ${w} ${HEIGHT}`}
        {...handlers}
        role="img"
        aria-label={t.debtChartLabel}
      >
        {[max, max / 2, 0].map((v) => (
          <g key={v}>
            <line className="gridline" x1={MARGIN.left} x2={w - MARGIN.right} y1={y(v)} y2={y(v)} />
            <text className="tick" x={MARGIN.left - 7} y={y(v) + 3} textAnchor="end">
              {v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : `${Math.round(v / 1000)}k`}
            </text>
          </g>
        ))}

        {series.map(({ loan, path }) => (
          <path
            key={loan.id}
            className="line"
            d={path}
            style={{ stroke: seriesColor(colorIndex[loan.id] ?? 0) }}
          />
        ))}

        {series.map(({ loan }) =>
          points.map((p, i) =>
            i % dotStep === 0 ? (
              <circle
                key={`${loan.id}-${p.month}`}
                className="dot"
                cx={x(i)}
                cy={y(p.debts[loan.id] ?? 0)}
                r={2.2}
                style={{ stroke: seriesColor(colorIndex[loan.id] ?? 0) }}
              />
            ) : null,
          ),
        )}

        {labels.map(({ loan, ly }) => (
          <text
            key={loan.id}
            className="series-label"
            x={w - MARGIN.right + 6}
            y={ly + 3}
            style={{ fill: seriesColor(colorIndex[loan.id] ?? 0) }}
          >
            {loan.description}
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
            {loans.map((loan) => (
              <circle
                key={loan.id}
                className="marker"
                cx={x(active)}
                cy={y(selected.debts[loan.id] ?? 0)}
                r={3.4}
                style={{ fill: seriesColor(colorIndex[loan.id] ?? 0) }}
              />
            ))}
          </>
        )}
      </svg>

      {/* Both layers always render so the box never resizes on hover. */}
      <div className="chart-detail">
        <div className="detail-layer" data-hidden={selected === null} aria-hidden={selected === null}>
          <div className="tooltip-month">{formatMonth(shown.month)}</div>
          {loans.map((loan) => (
            <div className="tooltip-row" key={loan.id}>
              <span>{loan.description}</span>
              <span>{sek(shown.debts[loan.id] ?? 0)}</span>
            </div>
          ))}
          <div className="tooltip-row total">
            <span>{t.total}</span>
            <strong>{sek(total)}</strong>
          </div>
        </div>

        <div className="detail-layer" data-hidden={selected !== null} aria-hidden={selected !== null}>
          <div className="legend">
            {loans.map((loan) => (
              <span className="legend-item" key={loan.id}>
                {loan.description}
                <em>{payoff[loan.id] ? formatMonthShort(payoff[loan.id]!) : t.notAmortized}</em>
              </span>
            ))}
          </div>
          <span className="hint">{t.pointForDebt}</span>
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
