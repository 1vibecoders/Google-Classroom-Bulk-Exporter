// Level, XP and achievements (SPEC.md § 28), worked out from the schedule
// (src/lib/progress.ts); nothing here changes the plan.
import { useMemo } from 'react';
import type { LocalDateTimeStr, ScheduleDocument } from '../../model/types';
import { computeProgress } from '../../lib/progress';
import { LatticeMeter, fractionCells } from '../../ui/LatticeMeter';

export function ProgressCard({ doc, now }: { doc: ScheduleDocument; now: LocalDateTimeStr }) {
  const p = useMemo(() => computeProgress(doc, now), [doc, now]);
  const earned = p.achievements.filter((a) => a.earned);
  const next = p.achievements.find((a) => !a.earned);
  return (
    <section className="card progress-card" aria-labelledby="progress-title">
      <div className="card-header">
        <h2 id="progress-title">
          Level {p.level} <span className="muted small">· {p.xp} XP</span>
        </h2>
      </div>
      <div className="card-body stack">
        <LatticeMeter cells={fractionCells(p.intoLevel, p.levelSize)} value={p.intoLevel} max={p.levelSize} label={`${p.intoLevel} of ${p.levelSize} XP toward level ${p.level + 1}`} />
        <p className="small muted" style={{ margin: 0 }}>
          {p.levelSize - p.intoLevel} XP to level {p.level + 1}. XP comes from finished sessions (up to 3 hours a day, not after 11 PM), finished work and
          early test preparation.
        </p>
        {earned.length ? (
          <p className="small" style={{ margin: 0 }}>
            Earned: {earned.map((a) => a.title).join(', ')}
          </p>
        ) : null}
        {next ? (
          <p className="small muted" style={{ margin: 0 }}>
            Next: {next.title}. {next.description}
          </p>
        ) : null}
      </div>
    </section>
  );
}
