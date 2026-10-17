// The Lattice mark (PRODUCT.md brand commitment, unchanged): an ink-green
// rounded tile with a cream diagonal lattice. Same geometry as the demo video
// (video/src/components/Icons.tsx): tile 100 units, corner radius 22, two
// lines each way at ±17 from the center, stroke 8, turned 45°.
import { useId } from 'react';

const LINES = [-17, 17];

export function LatticeMark({ size = 28, title }: { size?: number; title?: string }) {
  const clip = `lattice-${useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="lattice-mark" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <defs>
        <clipPath id={clip}>
          <rect width="100" height="100" rx="22" />
        </clipPath>
      </defs>
      <rect width="100" height="100" rx="22" className="lattice-mark-tile" />
      <g clipPath={`url(#${clip})`} transform="rotate(45 50 50)" className="lattice-mark-lines" strokeWidth="8" strokeLinecap="round">
        {LINES.map((p) => (
          <line key={`v${p}`} x1={50 + p} y1={-20} x2={50 + p} y2={120} />
        ))}
        {LINES.map((p) => (
          <line key={`h${p}`} x1={-20} y1={50 + p} x2={120} y2={50 + p} />
        ))}
      </g>
    </svg>
  );
}

/** "Lattice" with "Study" set smaller in small caps, as on the end card. */
export function Wordmark() {
  return (
    <span className="wordmark">
      <span className="wordmark-name">Lattice</span>
      <span className="wordmark-product">Study</span>
    </span>
  );
}
