/**
 * The mark from the app icon, drawn rather than shown. The geometry is copied from
 * icon.svg so the traced line is the logo exactly, minus its tile: on a loading
 * screen the line is the recognisable part, and ink on paper belongs here where a
 * blue square would not.
 */
export function Loading({ label }: { label: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <svg className="loading-mark" viewBox="0 0 512 512" aria-hidden="true">
        <path
          className="loading-line"
          d="M112 336 L192 256 L272 296 L400 168"
          pathLength={1}
          fill="none"
          stroke="currentColor"
          strokeWidth={34}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle className="loading-dot" cx={400} cy={168} r={26} fill="currentColor" />
      </svg>
      <span className="loading-label">{label}</span>
    </div>
  );
}
