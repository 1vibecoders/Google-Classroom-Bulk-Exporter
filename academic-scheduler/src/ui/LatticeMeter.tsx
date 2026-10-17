// Progress drawn in the mark's language: a row of small lattice diamonds
// (level progress, test readiness) instead of a generic bar. Each cell is
// full, partly done, needs attention, or empty; the row is one progressbar for
// assistive technology, with the meaning in words.
export type MeterCell = 'full' | 'part' | 'flag' | 'empty';

export function LatticeMeter({ cells, label, value, max }: { cells: MeterCell[]; label: string; value: number; max: number }) {
  return (
    <span className="lattice-meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      {cells.map((c, i) => (
        <span key={i} className={`lattice-cell is-${c}`} aria-hidden="true" />
      ))}
    </span>
  );
}

/** `count` cells for a fraction of `size`: whole cells full, the cell in progress partly filled (never rounded up). */
export function fractionCells(done: number, size: number, count = 10): MeterCell[] {
  const exact = size > 0 ? Math.min(count, (done / size) * count) : 0;
  const filled = Math.floor(exact);
  return Array.from({ length: count }, (_, i) => (i < filled ? 'full' : i === filled && exact > filled ? 'part' : 'empty'));
}
