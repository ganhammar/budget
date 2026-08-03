import { useEffect, useId, useRef, useState } from 'react';
import type { ForecastPoint } from '../domain/engine';
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
const HEIGHT = 200;

export function ForecastChart({ points }: { points: ForecastPoint[] }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const clipId = useId().replace(/:/g, '');

  if (points.length < 2) return null;

  const w = Math.max(width, 280);
  const plotW = w - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;

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
  const area = `${line} L${x(points.length - 1)},${zeroY} L${x(0)},${zeroY} Z`;
  const ticks = [max, (max + min) / 2, min];

  // A label like "aug 26" needs roughly 46px, so thin them out to whatever fits.
  const labelStep = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 46))));

  function onPointer(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * w;
    const i = Math.round(((px - MARGIN.left) / plotW) * (points.length - 1));
    setActive(Math.max(0, Math.min(points.length - 1, i)));
  }

  const selected = active === null ? null : points[active];
  const firstNegative = points.find((p) => p.closing < 0);

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
        aria-label="Prognos för saldot på gemensamt konto"
      >
        <defs>
          <clipPath id={`${clipId}-above`}>
            <rect x={0} y={0} width={w} height={Math.max(0, zeroY)} />
          </clipPath>
          <clipPath id={`${clipId}-below`}>
            <rect x={0} y={zeroY} width={w} height={Math.max(0, HEIGHT - zeroY)} />
          </clipPath>
        </defs>

        {ticks.map((v) => (
          <g key={v}>
            <line className="gridline" x1={MARGIN.left} x2={w - MARGIN.right} y1={y(v)} y2={y(v)} />
            <text className="tick" x={MARGIN.left - 8} y={y(v) + 3} textAnchor="end">
              {Math.round(v / 1000)}k
            </text>
          </g>
        ))}

        <line className="zero-line" x1={MARGIN.left} x2={w - MARGIN.right} y1={zeroY} y2={zeroY} />

        <path className="area" d={area} clipPath={`url(#${clipId}-above)`} />
        <path className="area-negative" d={area} clipPath={`url(#${clipId}-below)`} />
        <path className="line" d={line} />

        {points.map((p, i) =>
          i % labelStep === 0 && i <= points.length - 1 - labelStep / 2 ? (
            <text key={p.month} className="tick" x={x(i)} y={HEIGHT - 8} textAnchor="middle">
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
              r={5}
            />
          </>
        )}
      </svg>

      {selected ? (
        <div className="tooltip">
          <div className="tooltip-month">{formatMonth(selected.month)}</div>
          <div className="tooltip-row">
            <span>Saldo vid månadens slut</span>
            <strong className={selected.closing < 0 ? 'negative' : ''}>
              {sek(selected.closing)}
            </strong>
          </div>
          <div className="tooltip-row">
            <span>In från medlemmarna</span>
            <span>{sek(selected.inflow)}</span>
          </div>
          <div className="tooltip-row">
            <span>Ut från kontot</span>
            <span>{sek(selected.outflow)}</span>
          </div>
          {selected.items.slice(0, 4).map((item, i) => (
            <div className="tooltip-row" key={i} style={{ paddingLeft: 10, fontSize: 11 }}>
              <span>{item.label}</span>
              <span>{sek(item.amount)}</span>
            </div>
          ))}
        </div>
      ) : (
        <span className="hint" style={{ display: 'block', marginTop: 8 }}>
          {firstNegative
            ? `Kontot går under noll i ${formatMonth(firstNegative.month)}.`
            : 'Kontot håller sig över noll i hela perioden.'}{' '}
          Peka på grafen för detaljer.
        </span>
      )}
    </div>
  );
}

export function ForecastTable({ points }: { points: ForecastPoint[] }) {
  return (
    <div className="scroll-x">
      <table className="table">
        <thead>
          <tr>
            <th>Månad</th>
            <th>Ingående</th>
            <th>In</th>
            <th>Ut</th>
            <th>Utgående</th>
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
