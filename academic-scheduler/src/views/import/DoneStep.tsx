// Step 3 of the import: what was imported, an Undo button (restores the copy
// saved just before the import) and links to the Day view and Assignments.
import type { ScheduleDocument } from '../../model/types';
import { routeToHash } from '../../router';
import { formatDateWithWeekday } from '../../lib/time';
import { Icon } from '../../ui/Icon';
import { diffDocuments, diffLines, firstImportedDate } from './logic';

export interface ImportResult {
  fileName: string;
  snapshotId: string;
  before: ScheduleDocument;
  after: ScheduleDocument;
  undone: boolean;
}

export function DoneStep({
  result,
  today,
  canUndo,
  onUndo,
  onReview,
  onImportAnother,
  headingRef,
}: {
  result: ImportResult;
  today: string;
  canUndo: boolean;
  onUndo: () => void;
  onReview: () => void;
  onImportAnother: () => void;
  headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  const diff = diffDocuments(result.before, result.after);
  const lines = diffLines(diff);
  const first = firstImportedDate(result.before, result.after, today);
  const year = Number(today.slice(0, 4)) || undefined;

  if (result.undone) {
    return (
      <section className="card imp-done undone" aria-labelledby="imp-done-title">
        <div className="card-body stack">
          <h2 id="imp-done-title" className="imp-done-title" ref={headingRef} tabIndex={-1}>
            <Icon name="undo" size={20} /> <span>Import undone</span>
          </h2>
          <p style={{ margin: 0 }}>Your schedule is back to how it was before importing “{result.fileName}”.</p>
          <div className="row imp-done-actions">
            <button type="button" className="btn primary" onClick={onReview}>
              Review “{result.fileName}” again
            </button>
            <button type="button" className="btn" onClick={onImportAnother}>
              Import another file
            </button>
            <a className="btn ghost" href={routeToHash({ name: 'day', date: today })}>
              Day view
            </a>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="card imp-done" aria-labelledby="imp-done-title">
      <div className="card-body stack">
        <h2 id="imp-done-title" className="imp-done-title" ref={headingRef} tabIndex={-1}>
          <span className="imp-done-mark" aria-hidden="true">
            <Icon name="check" size={18} />
          </span>
          <span>Schedule imported</span>
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          From “{result.fileName}”. You can edit everything that was imported.
        </p>
        {lines.length ? (
          <dl className="imp-lines">
            {lines.map((line) => (
              <div key={line.label} className={`imp-line tone-${line.tone}`}>
                <dt>{line.label}:</dt>
                <dd>
                  <span className="imp-part">{line.text}</span>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p style={{ margin: 0 }}>The schedule’s details (title, sources or issues) were updated; no items changed.</p>
        )}
        <div className="row imp-done-actions">
          <a className="btn primary" href={routeToHash({ name: 'day', date: today })}>
            <Icon name="day" /> Open Day view
          </a>
          {first && first !== today ? (
            <a className="btn" href={routeToHash({ name: 'day', date: first })}>
              <Icon name="calendar" /> Go to {formatDateWithWeekday(first, year)}
            </a>
          ) : null}
          <a className="btn" href={routeToHash({ name: 'assignments' })}>
            <Icon name="list" /> Assignments
          </a>
        </div>
        <div className="imp-undo-row">
          <button type="button" className="btn" onClick={onUndo} disabled={!canUndo}>
            <Icon name="undo" /> Undo import
          </button>
          <span className="small muted">
            {canUndo
              ? 'Restores your schedule exactly as it was before this import.'
              : 'This import can no longer be undone here (the saved copy was replaced by a later change). See Settings → Undo history.'}
          </span>
          <button type="button" className="btn ghost" onClick={onImportAnother}>
            Import another file
          </button>
        </div>
      </div>
    </section>
  );
}
