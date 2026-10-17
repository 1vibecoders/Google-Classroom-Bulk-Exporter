// "Sessions that no longer fit" (SPEC.md § 26.2–26.3): planned sessions that
// now overlap a commitment or end after their deadline, with one action that
// moves only those (src/lib/repair.ts) as one undoable change. Work that still
// does not fit is named in the notice, never placed after its deadline.
import { useMemo } from 'react';
import type { LocalDateTimeStr, ScheduleDocument } from '../../model/types';
import { brokenSessions, repairPlan, type RepairResult } from '../../lib/repair';
import { nowLocal } from '../../lib/time';
import { useStore } from '../../state/store';
import { newSnapshotId } from '../import/logic';

/** " Moved 2 sessions that no longer fit." (leading space, for notices), or "". */
export function movedLine(moved: number): string {
  return moved ? ` Moved ${moved} ${moved === 1 ? 'session that no longer fits' : 'sessions that no longer fit'}.` : '';
}

/** What a repair did, in words, and whether work is at risk (names the first piece of work that does not fit). */
export function repairNotice(result: RepairResult, doc: ScheduleDocument): { text: string; atRisk: boolean } {
  const planned = result.sessions ? ` Planned ${result.sessions} new ${result.sessions === 1 ? 'session' : 'sessions'} in your free study time.` : '';
  const first = result.unplaced[0];
  const title = first ? doc.assignments.find((a) => a.id === first.assignmentId)?.title : undefined;
  const atRisk = first ? ` Not everything fits before its deadline. ${title ? `${title}: ` : ''}${first.reason}` : '';
  return { text: `${movedLine(result.moved)}${planned}${atRisk}`.trim(), atRisk: !!first };
}

export function RepairCard({ now }: { now: LocalDateTimeStr }) {
  const { state, dispatch, notify } = useStore();
  const doc = state.doc;
  const count = useMemo(() => brokenSessions(doc, now).length, [doc, now]);
  if (!count) return null;

  const repair = () => {
    const result = repairPlan(doc, nowLocal());
    const snapshotId = newSnapshotId();
    dispatch({ type: 'replaceDocument', doc: result.doc, label: 'Moved sessions that no longer fit', now: nowLocal(), snapshotId, details: result.changes });
    const notice = repairNotice(result, doc);
    notify(notice.text, {
      tone: notice.atRisk ? 'warning' : 'success',
      action: { label: 'Undo', run: () => dispatch({ type: 'undo', snapshotId }) },
    });
  };

  return (
    <section className="card ds-unmarked" aria-labelledby="repair-title">
      <div className="card-header">
        <h2 id="repair-title">{count === 1 ? '1 session no longer fits' : `${count} sessions no longer fit`}</h2>
      </div>
      <div className="card-body stack">
        <p className="small">
          {count === 1 ? 'A planned session overlaps' : 'Planned sessions overlap'} a commitment or other work, or {count === 1 ? 'ends' : 'end'} after the deadline. Only{' '}
          {count === 1 ? 'that session moves' : 'those sessions move'}; locked and your own sessions stay.
        </p>
        <button type="button" className="btn primary" onClick={repair}>
          Re-plan {count === 1 ? 'it' : 'them'}
        </button>
      </div>
    </section>
  );
}
