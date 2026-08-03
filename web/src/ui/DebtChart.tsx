import { useEffect, useId, useRef, useState } from 'react';
import type { DebtPoint } from '../domain/engine';
import type { Loan } from '../domain/types';
import { sek } from '../domain/format';
import { formatMonth, formatMonthShort } from '../domain/month';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

const MARGIN = { top: 12, right: 10, bottom: 24, left: 52 };
const HEIGHT = 220;

/** Fixed slot order. Colour follows the loan, never its rank in the stack. */
export function seriesColor(index: number): string {
  return `var(--series-${(index % 6) + 1})`;
}

interface ChartProps {
  points: DebtPoint[];
  /** Only the loans to draw. */
  loans: Loan[];
  /**
   * Loan id to palette slot, keyed off the full loan list rather than the visible
   * one. Hiding a loan must not repaint the ones that remain.
   */
  colorIndex: Record<string, number>;
}

export function DebtChart({ points, loans, colorIndex }: ChartProps) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const clipId = useId().replace(/:/g, '');

  if (points.length < 2 || loans.length === 0) return null;

  const w = Math.max(width, 280);
  const plotW = w - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;

  const max = Math.max(1, ...points.map((p) => loans.reduce((s, l) => s + (p.debts[l.id] ?? 0), 0)));

  const x = (i: number) => MARGIN.left + (i * plotW) / (points.length - 1);
  const y = (v: number) => MARGIN.top + plotH - (v / max) * plotH;

  // Cumulative bands, bottom to top, so the top edge is total debt.
  const bands = loans.map((loan, index) => {
    const lower: number[] = [];
    const upper: number[] = [];
    points.forEach((point, i) => {
      const below = loans
        .slice(0, index)
        .reduce((sum, l) => sum + (point.debts[l.id] ?? 0), 0);
      lower[i] = below;
      upper[i] = below + (point.debts[loan.id] ?? 0);
    });
    const top = upper.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ');
    // Traced back along the lower edge so the band closes as a filled ribbon.
    const bottom = lower
      .map((_, i) => {
        const j = lower.length - 1 - i;
        return `L${x(j)},${y(lower[j])}`;
      })
      .join(' ');
    return { loan, d: `${top} ${bottom} Z` };
  });

  const totalLine = points
    .map((p, i) => {
      const total = loans.reduce((s, l) => s + (p.debts[l.id] ?? 0), 0);
      return `${i === 0 ? 'M' : 'L'}${x(i)},${y(total)}`;
    })
    .join(' ');

  const ticks = [max, max / 2, 0];
  const labelStep = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 46))));

  function onPointer(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * w;
    const i = Math.round(((px - MARGIN.left) / plotW) * (points.length - 1));
    setActive(Math.max(0, Math.min(points.length - 1, i)));
  }

  const selected = active === null ? null : points[active];
  const selectedTotal = selected
    ? loans.reduce((s, l) => s + (selected.debts[l.id] ?? 0), 0)
    : 0;

  return (
    <div ref={ref}>
      <svg
        className="chart"
        width="100%"
        height={HEIGHT}
        viewBox={`0 0 ${w} ${HEIGHT}`}
        onPointerMove={onPointer}
        onPointerLeave={() => setActive(null)}
        role="img"
        aria-label="Skuld per lån över tid"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={MARGIN.left} y={0} width={plotW} height={HEIGHT} />
          </clipPath>
        </defs>

        {ticks.map((v) => (
          <g key={v}>
            <line className="gridline" x1={MARGIN.left} x2={w - MARGIN.right} y1={y(v)} y2={y(v)} />
            <text className="tick" x={MARGIN.left - 8} y={y(v) + 3} textAnchor="end">
              {v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : `${Math.round(v / 1000)}k`}
            </text>
          </g>
        ))}

        <g clipPath={`url(#${clipId})`}>
          {bands.map((band) => (
            <path
              key={band.loan.id}
              d={band.d}
              fill={seriesColor(colorIndex[band.loan.id] ?? 0)}
              stroke="var(--surface)"
              strokeWidth={1}
              opacity={0.85}
            />
          ))}
          <path d={totalLine} fill="none" stroke="var(--ink-2)" strokeWidth={1.5} />
        </g>

        {points.map((p, i) =>
          i % labelStep === 0 && i <= points.length - 1 - labelStep / 2 ? (
            <text key={p.month} className="tick" x={x(i)} y={HEIGHT - 8} textAnchor="middle">
              {formatMonthShort(p.month)}
            </text>
          ) : null,
        )}

        {selected && active !== null && (
          <line
            className="crosshair"
            x1={x(active)}
            x2={x(active)}
            y1={MARGIN.top}
            y2={MARGIN.top + plotH}
          />
        )}
      </svg>

      {/* Fixed height so hovering never resizes the card and moves the chart. */}
      <div className="chart-detail" style={{ minHeight: 34 + loans.length * 18 }}>
        {selected ? (
          <>
            <div className="tooltip-month">{formatMonth(selected.month)}</div>
            {loans.map((loan) => (
              <div className="tooltip-row" key={loan.id}>
                <span>
                  <i className="swatch" style={{ background: seriesColor(colorIndex[loan.id] ?? 0) }} />
                  {loan.description}
                </span>
                <span>{sek(selected.debts[loan.id] ?? 0)}</span>
              </div>
            ))}
            <div className="tooltip-row total">
              <span>Totalt</span>
              <strong>{sek(selectedTotal)}</strong>
            </div>
          </>
        ) : (
          <>
            <div className="legend">
              {loans.map((loan) => (
                <span className="legend-item" key={loan.id}>
                  <i className="swatch" style={{ background: seriesColor(colorIndex[loan.id] ?? 0) }} />
                  {loan.description}
                </span>
              ))}
            </div>
            <span className="hint">Peka på grafen för skulden en viss månad.</span>
          </>
        )}
      </div>
    </div>
  );
}

export function DebtTable({ points, loans }: { points: DebtPoint[]; loans: Loan[] }) {
  // One row per year keeps this readable over a payoff that runs for decades.
  const yearly = points.filter((p, i) => i === 0 || p.month.endsWith('-01'));

  return (
    <div className="scroll-x">
      <table className="table">
        <thead>
          <tr>
            <th>Månad</th>
            {loans.map((l) => (
              <th key={l.id}>{l.description}</th>
            ))}
            <th>Totalt</th>
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
