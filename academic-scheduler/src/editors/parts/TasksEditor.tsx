// Subtasks of an assignment (§ 9): add, edit, reorder (buttons, keyboard
// operable), remove (with undo), status, estimate, dates and dependencies.
import { useState } from 'react';
import { WORK_STATUSES, WORK_STATUS_LABELS } from '../../model/constants';
import type { Task, WorkStatus } from '../../model/types';
import { formatDateOrDateTime, formatDuration } from '../../lib/time';
import { Icon } from '../../ui/Icon';
import { Checkbox, DateField, SelectField, TextArea, TextField } from '../../ui/fields';
import { newTaskRow, taskGraph, type TaskRow } from './assignmentForm';
import { valueOfParts, wouldCycle } from './common';
import { ChipPicker, DateTimeInput, MinutesInput } from './inputs';
import { TaskIssues } from './ItemPanel';
import { describeFields, plural } from './labels';

export function TasksEditor({
  rows,
  onChange,
  error,
  newTaskId,
  blockCounts,
  stored,
}: {
  rows: TaskRow[];
  onChange: (rows: TaskRow[]) => void;
  error: (key: string) => string | null;
  /** A new, unused task id. */
  newTaskId: () => string;
  /** Scheduled blocks per task id. */
  blockCounts: Map<string, number>;
  /** The tasks as stored now, by id (their overrides, pin and issues may change while the form is open). */
  stored?: Map<string, Task>;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [draft, setDraft] = useState('');
  const [removed, setRemoved] = useState<{ row: TaskRow; index: number; dependents: string[] } | null>(null);

  const update = (id: string, patch: Partial<TaskRow>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const toggle = (id: string) =>
    setExpanded((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = rows.slice();
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const remove = (index: number) => {
    const row = rows[index];
    const dependents = rows.filter((r) => r.dependsOn.includes(row.id)).map((r) => r.id);
    setRemoved({ row, index, dependents });
    onChange(rows.filter((r) => r.id !== row.id).map((r) => (r.dependsOn.includes(row.id) ? { ...r, dependsOn: r.dependsOn.filter((d) => d !== row.id) } : r)));
  };
  const undoRemove = () => {
    if (!removed) return;
    const next = rows.map((r) => (removed.dependents.includes(r.id) && !r.dependsOn.includes(removed.row.id) ? { ...r, dependsOn: [...r.dependsOn, removed.row.id] } : r));
    next.splice(Math.min(removed.index, next.length), 0, removed.row);
    onChange(next);
    setRemoved(null);
  };
  const add = () => {
    const title = draft.trim();
    const row = newTaskRow(newTaskId(), title);
    onChange([...rows, row]);
    setDraft('');
    if (!title) setExpanded((set) => new Set(set).add(row.id));
  };

  const graph = taskGraph(rows);

  return (
    <div className="ed-tasks">
      {rows.length === 0 ? <p className="muted small">No subtasks. Split larger work into steps, e.g. outline, draft, revise.</p> : null}
      <ol className="ed-task-list">
        {rows.map((row, index) => {
          const open = expanded.has(row.id);
          const name = row.title.trim() || `Subtask ${index + 1}`;
          const k = (field: string) => `tasks.${row.id}.${field}`;
          const rowHasError = ['title', 'description', 'notes', 'estimatedMinutes', 'due', 'recommendedCompletionDate', 'recommendedStartDate', 'dependsOn'].some((f) => error(k(f)));
          const due = valueOfParts(row.due);
          const blocks = blockCounts.get(row.id) ?? 0;
          const current = stored?.get(row.id) ?? row.base;
          const overrides = current && (current.origin ?? 'generated') !== 'user' ? current.overrides || [] : [];
          const locked = !!current?.locked;
          const options = rows
            .filter((r) => r.id !== row.id)
            .map((r) => ({
              id: r.id,
              label: `${rows.indexOf(r) + 1}. ${r.title.trim() || 'Untitled subtask'}`,
              disabledReason: wouldCycle(graph, row.id, r.id) ? 'depends on this one' : undefined,
            }));
          return (
            <li key={row.id} className={`ed-task ${row.status === 'done' ? 'done' : ''} ${row.status === 'cancelled' ? 'cancelled' : ''}`} aria-label={`Subtask ${index + 1}: ${name}`}>
              <div className="ed-task-head">
                <span className="ed-task-num" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="ed-task-title">
                  <TextField label={`Subtask ${index + 1}`} required value={row.title} onChange={(v) => update(row.id, { title: v })} error={error(k('title'))} />
                </div>
                <div className="ed-task-status">
                  <SelectField<WorkStatus>
                    label="Status"
                    value={row.status}
                    options={WORK_STATUSES.map((s) => ({ value: s, label: WORK_STATUS_LABELS[s] }))}
                    onChange={(v) => update(row.id, { status: (v || 'not_started') as WorkStatus })}
                  />
                </div>
                <div className="ed-task-estimate">
                  <MinutesInput label="Estimate" compact value={row.estimatedMinutes} onChange={(v) => update(row.id, { estimatedMinutes: v })} error={error(k('estimatedMinutes'))} />
                </div>
                <div className="ed-task-actions">
                  <button type="button" className="btn ghost icon small" aria-label={`Move “${name}” up`} disabled={index === 0} onClick={() => move(index, -1)}>
                    <span className="ed-flip" aria-hidden="true">
                      <Icon name="chevronDown" size={14} />
                    </span>
                  </button>
                  <button type="button" className="btn ghost icon small" aria-label={`Move “${name}” down`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}>
                    <Icon name="chevronDown" size={14} />
                  </button>
                  <button type="button" className={`btn ghost small ${rowHasError && !open ? 'ed-has-error' : ''}`} aria-expanded={open} onClick={() => toggle(row.id)}>
                    {open ? 'Less' : 'More'}
                    <span className="visually-hidden"> details for “{name}”</span>
                  </button>
                  <button type="button" className="btn ghost icon small" aria-label={`Remove “${name}”`} onClick={() => remove(index)}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
              {!open ? (
                <div className="ed-task-summary small muted">
                  {due ? <span>Due {formatDateOrDateTime(due)}</span> : null}
                  {row.dependsOn.length ? <span>After {plural(row.dependsOn.length, 'subtask')}</span> : null}
                  {!row.required ? <span>Optional</span> : null}
                  {blocks ? <span>{plural(blocks, 'session')} scheduled</span> : null}
                  {overrides.length ? <span className="badge">Edited</span> : null}
                  {locked ? <span className="badge">Pinned</span> : null}
                  {rowHasError ? (
                    <span className="ed-error-text">
                      <Icon name="warning" size={12} /> Needs attention
                    </span>
                  ) : null}
                </div>
              ) : (
                <div className="ed-task-body">
                  <div className="form-grid">
                    <DateTimeInput
                      label="Checkpoint due"
                      value={row.due}
                      onChange={(v) => update(row.id, { due: v })}
                      hint="A hard deadline for this step (not later than the assignment’s due date)."
                      error={error(k('due'))}
                    />
                    <DateTimeInput
                      label="Target date"
                      value={row.recommendedCompletionDate}
                      onChange={(v) => update(row.id, { recommendedCompletionDate: v })}
                      hint="When it should ideally be done."
                      error={error(k('recommendedCompletionDate'))}
                    />
                    <DateField label="Start on or after" value={row.recommendedStartDate} onChange={(v) => update(row.id, { recommendedStartDate: v })} error={error(k('recommendedStartDate'))} />
                    <Checkbox
                      label="Required step"
                      checked={row.required}
                      onChange={(v) => update(row.id, { required: v })}
                      hint="Optional steps are not planned automatically or counted in remaining work."
                    />
                    <div className="span-2">
                      <ChipPicker
                        label="Do after"
                        selected={row.dependsOn}
                        options={options}
                        onChange={(ids) => update(row.id, { dependsOn: ids })}
                        emptyText="Can be done any time."
                        addLabel="Add a subtask to finish first…"
                        error={error(k('dependsOn'))}
                      />
                    </div>
                    {row.base?.estimateRange ? (
                      <div className="span-2 ed-range small">
                        {row.removeRange ? (
                          <>
                            <span>The estimate range will be removed when you save.</span>
                            <button type="button" className="btn small ghost" onClick={() => update(row.id, { removeRange: false })}>
                              Keep range
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="muted">
                              Estimate range from the source: {formatDuration(row.base.estimateRange.min)} – {formatDuration(row.base.estimateRange.max)}
                            </span>
                            <button type="button" className="btn small ghost" onClick={() => update(row.id, { removeRange: true })}>
                              Remove range
                            </button>
                          </>
                        )}
                      </div>
                    ) : null}
                    <TextArea className="span-2" label="Details" rows={2} value={row.description} onChange={(v) => update(row.id, { description: v })} error={error(k('description'))} />
                    <TextArea className="span-2" label="Your notes" rows={2} value={row.notes} onChange={(v) => update(row.id, { notes: v })} error={error(k('notes'))} />
                  </div>
                  {blocks || overrides.length || locked ? (
                    <p className="small muted ed-task-meta">
                      {blocks ? `${plural(blocks, 'scheduled session')}. ` : ''}
                      {overrides.length ? `Your edits to the ${describeFields(overrides)} are kept when /academic-schedule updates the schedule. ` : ''}
                      {locked ? 'Pinned.' : ''}
                    </p>
                  ) : null}
                  <TaskIssues issues={current?.issues} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {removed ? (
        <div className="ed-undo small" role="status">
          <span>
            Removed “{removed.row.title.trim() || 'subtask'}” (when you save).
            {blockCounts.get(removed.row.id) ? ` Its ${plural(blockCounts.get(removed.row.id) ?? 0, 'scheduled session')} will stay, for the assignment as a whole.` : ''}
            {removed.row.base && (removed.row.base.origin ?? 'generated') === 'generated' ? ' /academic-schedule will not add it again.' : ''}
          </span>
          <button type="button" className="btn small ghost" onClick={undoRemove}>
            <Icon name="undo" size={14} />
            Undo
          </button>
        </div>
      ) : null}
      <div className="ed-task-add">
        <input
          className="input"
          value={draft}
          placeholder="New subtask, e.g. “Write outline”"
          aria-label="New subtask title"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn small" onClick={add}>
          <Icon name="plus" size={14} />
          Add subtask
        </button>
      </div>
    </div>
  );
}
