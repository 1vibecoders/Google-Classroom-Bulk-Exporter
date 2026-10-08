// One assignment in the assignment view: a compact row (one-click done,
// dates, remaining work per § 8.1, scheduled/unscheduled minutes, subtasks,
// next session, issues, badges) that expands into full details (subtasks to
// check off, sessions, references, issues, source and control).
import { useId, type ReactNode } from 'react';
import { ASSIGNMENT_TYPE_LABELS, CONFIDENCES, WORK_STATUSES, WORK_STATUS_LABELS } from '../../model/constants';
import type { Assignment, BlockStatus, LocalDateTimeStr, ScheduleBlock, ScheduleDocument, Task, WorkStatus } from '../../model/types';
import { useStore } from '../../state/store';
import { useEditors } from '../../editors/EditorHost';
import { routeToHash } from '../../router';
import { ClassChip, PriorityBadge, StatusBadge, TypeBadge, useConfirm } from '../../ui/common';
import { Icon } from '../../ui/Icon';
import { Menu } from '../../ui/Menu';
import {
  addDays,
  dateOf,
  formatDateShort,
  formatDateWithWeekday,
  formatDuration,
  isValidDateOrDateTime,
  isValidLocalDateTime,
  ldtToMinutes,
  nowLocal,
} from '../../lib/time';
import { blockMinutes, taskRemainingMinutes } from '../../lib/workload';
import { assignmentIssues, isClosed, type AssignmentRow } from './assignmentModel';
import { formatBlockTime, formatLdt, formatTimeRange, formatWhen, plural, relativeDays } from './format';
import { IssuePanel } from './IssuePanel';
import { ControlBadges, ProvenancePanel, SourceStateBadge } from './Provenance';
import { ReferenceList } from './ReferenceList';

interface CardProps {
  row: AssignmentRow;
  doc: ScheduleDocument;
  now: LocalDateTimeStr;
  expanded: boolean;
  onToggle: () => void;
  onPlan: (assignmentIds: string[]) => void;
}

const CONFIDENCE_LABELS: Record<(typeof CONFIDENCES)[number], string> = { low: 'low confidence', medium: 'medium confidence', high: 'high confidence' };

function statusOfBlock(b: ScheduleBlock): BlockStatus {
  return b.status ?? 'planned';
}

/** "Due Fri, Oct 16, 11:59 PM · in 9 days" style date facts for the row. */
function DateFacts({ assignment, today, year }: { assignment: Assignment; today: string; year: number }) {
  const facts: ReactNode[] = [];
  const closed = isClosed(assignment);
  const word = assignment.type && ['quiz', 'test', 'exam', 'presentation'].includes(assignment.type) ? ASSIGNMENT_TYPE_LABELS[assignment.type] : 'Assessment';
  if (assignment.due && isValidDateOrDateTime(assignment.due)) {
    facts.push(
      <span key="due" className="ls-date">
        <Icon name="calendar" size={13} />
        <span>
          Due <strong>{formatWhen(assignment.due, year)}</strong>
          {!closed ? <span className="muted"> · {relativeDays(dateOf(assignment.due), today)}</span> : null}
        </span>
      </span>,
    );
  }
  if (assignment.assessmentDate && isValidDateOrDateTime(assignment.assessmentDate)) {
    facts.push(
      <span key="assessment" className="ls-date">
        <Icon name="target" size={13} />
        <span>
          {word} <strong>{formatWhen(assignment.assessmentDate, year)}</strong>
          {!closed ? <span className="muted"> · {relativeDays(dateOf(assignment.assessmentDate), today)}</span> : null}
        </span>
      </span>,
    );
  }
  if (assignment.recommendedCompletionDate && isValidDateOrDateTime(assignment.recommendedCompletionDate) && !closed) {
    facts.push(
      <span key="aim" className="ls-date muted">
        Aim to finish {formatWhen(assignment.recommendedCompletionDate, year)}
      </span>,
    );
  }
  if (facts.length === 0)
    facts.push(
      <span key="none" className="ls-date muted">
        No due date
      </span>,
    );
  return <div className="ls-dates">{facts}</div>;
}

function WorkSummary({ row, year }: { row: AssignmentRow; year: number }) {
  const p = row.progress;
  const a = row.assignment;
  const closed = isClosed(a);
  const estimate = p.estimatedMinutes;
  const remaining = p.remainingMinutes;
  const donePct = estimate && remaining !== null && estimate > 0 ? Math.max(0, Math.min(100, Math.round(((estimate - remaining) / estimate) * 100))) : null;
  let notCounted: string | null = null;
  if (!closed && !p.counts) {
    notCounted = a.required === false ? 'Optional — not counted' : 'Not counted (no longer in its source)';
  }
  return (
    <div className="ls-work">
      {closed ? (
        <div className="ls-work-line">
          <StatusBadge status={a.status ?? 'not_started'} />
          {a.status === 'done' && a.completedAt && isValidLocalDateTime(a.completedAt) ? (
            <span className="small muted"> {formatDateShort(a.completedAt.slice(0, 10), year)}</span>
          ) : null}
        </div>
      ) : notCounted ? (
        <div className="ls-work-line small muted">{notCounted}</div>
      ) : remaining === null ? (
        <div className="ls-work-line">
          <span className="badge warning" title="Add an estimated duration to count and plan this work.">
            No estimate
          </span>
        </div>
      ) : (
        <div className="ls-work-line">
          <span className="ls-remaining">
            <strong>{formatDuration(remaining)}</strong> left
          </span>
          {estimate !== null ? <span className="small muted"> of {formatDuration(estimate)}</span> : null}
        </div>
      )}
      {donePct !== null && !closed && p.counts ? (
        <div className="progress" role="img" aria-label={`${donePct}% of the estimated work done`}>
          <span style={{ width: `${donePct}%` }} />
        </div>
      ) : null}
      {!closed && p.counts && remaining !== null ? (
        <div className="small ls-sched">
          <span>{formatDuration(Math.min(p.scheduledMinutes, remaining))} scheduled</span>
          {' · '}
          <span className={p.unscheduledMinutes ? 'ls-unscheduled' : 'muted'}>{formatDuration(p.unscheduledMinutes ?? 0)} unscheduled</span>
        </div>
      ) : null}
      {p.tasksTotal > 0 ? (
        <div className="small muted">
          Subtasks {p.tasksDone}/{p.tasksTotal} done
        </div>
      ) : null}
      {!closed && p.nextBlock ? (
        <div className="small">
          <span className="muted">Next session: </span>
          <a href={routeToHash({ name: 'day', date: p.nextBlock.start.slice(0, 10) })}>{formatLdt(p.nextBlock.start, year)}</a>
        </div>
      ) : null}
    </div>
  );
}

export function AssignmentCard({ row, doc, now, expanded, onToggle, onPlan }: CardProps) {
  const { dispatch, notify } = useStore();
  const editors = useEditors();
  const confirm = useConfirm();
  const detailsId = useId();
  const a = row.assignment;
  const p = row.progress;
  const today = now.slice(0, 10);
  const year = Number(today.slice(0, 4));
  const done = a.status === 'done';
  const closed = isClosed(a);
  const className = row.schoolClass?.name;

  const toggleDone = () => {
    const before = a;
    const next: WorkStatus = done ? (p.doneMinutes > 0 || p.tasksDone > 0 ? 'in_progress' : 'not_started') : 'done';
    dispatch({ type: 'setAssignmentStatus', id: a.id, status: next, now: nowLocal() });
    const nowMin = ldtToMinutes(nowLocal());
    const futurePlanned = p.blocks.filter(
      (b) => statusOfBlock(b) === 'planned' && (b.kind ?? 'work') === 'work' && isValidLocalDateTime(b.end) && ldtToMinutes(b.end) > nowMin,
    ).length;
    const message = done
      ? `“${a.title}” is open again (${WORK_STATUS_LABELS[next].toLowerCase()}).`
      : `Marked “${a.title}” done.${futurePlanned ? ` It still has ${plural(futurePlanned, 'planned session')} on your calendar.` : ''}`;
    notify(message, { tone: 'success', action: { label: 'Undo', run: () => dispatch({ type: 'upsertAssignment', item: before, now: nowLocal() }) } });
  };

  const setStatus = (status: WorkStatus) => {
    if (status === (a.status ?? 'not_started')) return;
    dispatch({ type: 'setAssignmentStatus', id: a.id, status, now: nowLocal() });
  };

  const remove = async () => {
    const blocks = p.blocks;
    const doneBlocks = blocks.filter((b) => statusOfBlock(b) === 'done');
    const sittings = doc.events.filter((e) => e.assignmentId === a.id);
    const ok = await confirm({
      title: `Delete “${a.title}”?`,
      danger: true,
      confirmLabel: 'Delete assignment',
      message: (
        <div className="stack" style={{ gap: 8 }}>
          <p style={{ margin: 0 }}>
            This removes the assignment{a.tasks?.length ? ` and its ${plural(a.tasks.length, 'subtask')}` : ''}
            {blocks.length ? `, its ${plural(blocks.length, 'scheduled session')}` : ''}
            {sittings.length ? ` and ${plural(sittings.length, 'linked event')} (${sittings.map((e) => e.title).join(', ')})` : ''}.
          </p>
          {doneBlocks.length ? (
            <p className="banner warning" style={{ margin: 0 }}>
              <Icon name="warning" /> {plural(doneBlocks.length, 'session')} you marked done (
              {formatDuration(doneBlocks.reduce((s, b) => s + blockMinutes(b), 0))}) will be deleted too, and with them the record of that work.
            </p>
          ) : null}
          {(a.origin ?? 'generated') === 'generated' ? (
            <p className="small muted" style={{ margin: 0 }}>
              It was imported from /academic-schedule. The website remembers that you deleted it, so a later import or /academic-schedule run does not add it
              again.
            </p>
          ) : null}
        </div>
      ),
    });
    if (!ok) return;
    dispatch({ type: 'deleteAssignment', id: a.id, now: nowLocal() });
    notify(`Deleted “${a.title}”.`, { tone: 'success' });
  };

  const scheduleSession = () => {
    const nowValue = nowLocal();
    const day = nowValue.slice(11, 16) < '16:00' ? nowValue.slice(0, 10) : addDays(nowValue.slice(0, 10), 1);
    const length = Math.max(15, Math.min(60, p.unscheduledMinutes || 60));
    const endMinutes = 16 * 60 + length;
    const end = `${day}T${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}:00`;
    editors.open({ kind: 'block', initial: { assignmentId: a.id, start: `${day}T16:00:00`, end } });
  };

  return (
    <li
      className={`ls-asg${expanded ? ' is-expanded' : ''}${closed ? ' is-closed' : ''}${row.group === 'overdue' ? ' is-overdue' : ''}`}
      style={{ ['--class-color' as string]: row.color }}
    >
      <div className="ls-asg-main">
        <label className="ls-done-toggle" title={done ? 'Mark as not done' : 'Mark as done'}>
          <input type="checkbox" checked={done} onChange={toggleDone} aria-label={done ? `Mark “${a.title}” as not done` : `Mark “${a.title}” done`} />
        </label>
        <div className="ls-asg-info">
          <div className="ls-asg-badges">
            {className ? <ClassChip name={className} color={row.color} /> : <span className="class-chip muted">No class</span>}
            <TypeBadge type={a.type ?? 'homework'} />
            {a.priority && a.priority !== 'medium' ? <PriorityBadge priority={a.priority} /> : null}
            {a.status === 'in_progress' ? <StatusBadge status="in_progress" /> : null}
            {row.group === 'overdue' ? <span className="badge danger">Overdue</span> : null}
            {a.required === false ? <span className="badge">Optional</span> : null}
            <SourceStateBadge state={a.sourceState} />
            <ControlBadges item={a} />
            {row.openIssues ? (
              <span className="badge warning" title="Open issues — see details">
                <Icon name="warning" size={12} />
                {plural(row.openIssues, 'issue')}
              </span>
            ) : null}
          </div>
          <h3 className="ls-asg-title">
            <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={detailsId}>
              <span className={a.status === 'cancelled' ? 'strike' : done ? 'ls-done-title' : undefined}>{a.title}</span>
              <Icon name="chevronDown" size={14} />
            </button>
          </h3>
          <DateFacts assignment={a} today={today} year={year} />
        </div>
        <WorkSummary row={row} year={year} />
        <div className="ls-asg-actions">
          <button
            type="button"
            className="btn ghost icon small"
            onClick={() => editors.open({ kind: 'assignment', id: a.id })}
            aria-label={`Edit “${a.title}”`}
            title="Edit"
          >
            <Icon name="edit" />
          </button>
          <Menu
            label={<Icon name="menu" />}
            buttonClass="btn ghost icon small"
            ariaLabel={`More actions for “${a.title}”`}
            items={[
              { label: 'Schedule a work session', icon: 'clock', onSelect: scheduleSession },
              { label: 'Plan unscheduled work', icon: 'wand', onSelect: () => onPlan([a.id]), disabled: closed || !p.counts },
              ...(a.status !== 'in_progress' && !closed
                ? [{ label: 'Mark in progress', icon: 'repeat' as const, onSelect: () => setStatus('in_progress') }]
                : []),
              ...(a.status !== 'cancelled' ? [{ label: 'Mark cancelled (won’t do)', icon: 'x' as const, onSelect: () => setStatus('cancelled') }] : []),
              { label: 'Delete', icon: 'trash', danger: true, onSelect: () => void remove() },
            ]}
          />
        </div>
      </div>
      {expanded ? (
        <div id={detailsId} className="ls-asg-details">
          <AssignmentDetails row={row} doc={doc} now={now} onSetStatus={setStatus} onScheduleSession={scheduleSession} />
        </div>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ls-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function AssignmentDetails({
  row,
  doc,
  now,
  onSetStatus,
  onScheduleSession,
}: {
  row: AssignmentRow;
  doc: ScheduleDocument;
  now: LocalDateTimeStr;
  onSetStatus: (status: WorkStatus) => void;
  onScheduleSession: () => void;
}) {
  const a = row.assignment;
  const p = row.progress;
  const year = Number(now.slice(0, 4));
  const statusId = useId();
  const sittings = doc.events.filter((e) => e.assignmentId === a.id);
  const dependsOn = (a.dependsOn || []).map((id) => doc.assignments.find((x) => x.id === id)).filter((x): x is Assignment => !!x);
  const issues = assignmentIssues(doc, a);

  return (
    <div className="ls-details-grid">
      <div className="stack ls-details-main">
        <div className="row">
          <label htmlFor={statusId} className="small muted">
            Status
          </label>
          <select
            id={statusId}
            className="select ls-status-select"
            value={a.status ?? 'not_started'}
            onChange={(e) => onSetStatus(e.target.value as WorkStatus)}
          >
            {WORK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {WORK_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {a.status === 'done' && a.completedAt && isValidLocalDateTime(a.completedAt) ? (
            <span className="small muted">Completed {formatLdt(a.completedAt, year)}</span>
          ) : null}
        </div>

        {a.description ? (
          <div>
            <h4 className="ls-subhead">Instructions</h4>
            <p className="ls-text">{a.description}</p>
          </div>
        ) : null}
        {a.notes ? (
          <div>
            <h4 className="ls-subhead">Your notes</h4>
            <p className="ls-text">{a.notes}</p>
          </div>
        ) : null}

        <dl className="ls-facts">
          {a.due ? (
            <Fact label="Due">
              {formatWhen(a.due, year)}
              {a.due.length === 10 ? <span className="muted"> (no time given)</span> : null}
            </Fact>
          ) : null}
          {a.assessmentDate ? <Fact label="Takes place">{formatWhen(a.assessmentDate, year)}</Fact> : null}
          {a.recommendedCompletionDate ? <Fact label="Aim to finish by">{formatWhen(a.recommendedCompletionDate, year)}</Fact> : null}
          <Fact label="Estimated total">
            {p.estimatedMinutes !== null ? formatDuration(p.estimatedMinutes) : 'Not estimated'}
            {a.estimateRange ? (
              <span className="muted">
                {' '}
                (range {formatDuration(a.estimateRange.min)}–{formatDuration(a.estimateRange.max)})
              </span>
            ) : null}
            {a.estimateConfidence ? <span className="muted"> · {CONFIDENCE_LABELS[a.estimateConfidence]}</span> : null}
          </Fact>
          <Fact label="Remaining">
            {p.remainingMinutes !== null ? formatDuration(p.remainingMinutes) : 'Unknown'}
            {p.doneMinutes > 0 ? <span className="muted"> · {formatDuration(p.doneMinutes)} done in sessions</span> : null}
          </Fact>
          {a.estimateBasis ? <Fact label="Estimate based on">{a.estimateBasis}</Fact> : null}
          {a.topic ? <Fact label="Topic">{a.topic}</Fact> : null}
          {a.points ? <Fact label="Points">{a.points}</Fact> : null}
          {a.required === false ? <Fact label="Required">No — optional work</Fact> : null}
          {dependsOn.length ? (
            <Fact label="Do first">
              {dependsOn.map((d, i) => (
                <span key={d.id}>
                  {i ? ', ' : ''}
                  {d.title}
                  {d.status === 'done' ? <span className="muted"> (done)</span> : null}
                </span>
              ))}
            </Fact>
          ) : null}
          {sittings.length ? (
            <Fact label="Sitting">
              {sittings.map((e, i) => (
                <span key={e.id}>
                  {i ? '; ' : ''}
                  {e.title}
                  {e.date ? ` · ${formatWhen(e.date, year)}` : ''}
                  {e.startTime && e.endTime ? `, ${formatTimeRange(e.startTime, e.endTime)}` : ''}
                </span>
              ))}
            </Fact>
          ) : null}
        </dl>

        <TaskList assignment={a} doc={doc} year={year} />
        <SessionList assignment={a} blocks={p.blocks} now={now} year={year} onScheduleSession={onScheduleSession} />
      </div>
      <div className="stack ls-details-side">
        <div>
          <h4 className="ls-subhead">References</h4>
          <ReferenceList references={a.references} empty="No attachments or links." />
        </div>
        <IssuePanel entries={issues} />
        <div>
          <h4 className="ls-subhead">Source and control</h4>
          <ProvenancePanel item={a} collection="assignments" currentYear={year} />
        </div>
      </div>
    </div>
  );
}

function TaskList({ assignment, doc, year }: { assignment: Assignment; doc: ScheduleDocument; year: number }) {
  const { dispatch } = useStore();
  const tasks = assignment.tasks || [];
  if (tasks.length === 0) return null;
  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  const toggle = (task: Task) => {
    const next: WorkStatus = task.status === 'done' ? 'not_started' : 'done';
    dispatch({ type: 'setTaskStatus', assignmentId: assignment.id, taskId: task.id, status: next, now: nowLocal() });
  };
  return (
    <div>
      <h4 className="ls-subhead">Subtasks</h4>
      <ol className="ls-tasks">
        {tasks.map((task) => {
          const done = task.status === 'done';
          const remaining = taskRemainingMinutes(doc, assignment, task);
          const deps = (task.dependsOn || []).map((id) => byId.get(id)?.title).filter(Boolean);
          return (
            <li key={task.id} className={done ? 'is-done' : task.status === 'cancelled' ? 'is-cancelled' : undefined}>
              <label className="checkbox">
                <input type="checkbox" checked={done} onChange={() => toggle(task)} disabled={task.status === 'cancelled'} />
                <span className={task.status === 'cancelled' ? 'strike' : undefined}>{task.title}</span>
              </label>
              <div className="ls-task-meta small muted">
                {task.estimatedMinutes !== undefined ? <span>{formatDuration(task.estimatedMinutes)} estimated</span> : null}
                {!done && task.status !== 'cancelled' && task.estimatedMinutes !== undefined ? <span>{formatDuration(remaining)} left</span> : null}
                {task.status === 'in_progress' ? <span>In progress</span> : null}
                {task.status === 'cancelled' ? <span>Cancelled</span> : null}
                {task.required === false ? <span>Optional</span> : null}
                {task.recommendedStartDate ? <span>Start {formatWhen(task.recommendedStartDate, year)}</span> : null}
                {task.recommendedCompletionDate ? <span>Aim {formatWhen(task.recommendedCompletionDate, year)}</span> : null}
                {task.due ? <span className="ls-task-due">Due {formatWhen(task.due, year)}</span> : null}
                {deps.length ? <span>After: {deps.join(', ')}</span> : null}
                {task.locked ? (
                  <span>
                    <Icon name="lock" size={11} /> Pinned
                  </span>
                ) : null}
              </div>
              {task.description ? <p className="ls-text small">{task.description}</p> : null}
              {task.notes ? <p className="ls-text small muted">Note: {task.notes}</p> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SessionList({
  assignment,
  blocks,
  now,
  year,
  onScheduleSession,
}: {
  assignment: Assignment;
  blocks: ScheduleBlock[];
  now: LocalDateTimeStr;
  year: number;
  onScheduleSession: () => void;
}) {
  const { dispatch } = useStore();
  const editors = useEditors();
  const nowMin = isValidLocalDateTime(now) ? ldtToMinutes(now) : Number.POSITIVE_INFINITY;
  const tasks = new Map((assignment.tasks || []).map((t) => [t.id, t] as const));
  const setStatus = (b: ScheduleBlock, status: BlockStatus) => dispatch({ type: 'setBlockStatus', id: b.id, status, now: nowLocal() });
  return (
    <div>
      <div className="row ls-subhead-row">
        <h4 className="ls-subhead">Scheduled sessions</h4>
        <button type="button" className="btn small" onClick={onScheduleSession}>
          <Icon name="plus" size={14} /> Add session
        </button>
      </div>
      {blocks.length === 0 ? (
        <p className="small muted">No sessions scheduled yet.</p>
      ) : (
        <ul className="ls-sessions">
          {blocks.map((b) => {
            const status = statusOfBlock(b);
            const valid = isValidLocalDateTime(b.start) && isValidLocalDateTime(b.end);
            const past = valid && ldtToMinutes(b.end) <= nowMin;
            const task = b.taskId ? tasks.get(b.taskId) : undefined;
            const date = valid ? b.start.slice(0, 10) : '';
            return (
              <li key={b.id} className={`ls-session is-${status}${past && status === 'planned' ? ' is-unmarked' : ''}`}>
                <div className="ls-session-when">
                  {valid ? <a href={routeToHash({ name: 'day', date })}>{formatDateWithWeekday(date, year)}</a> : null}
                  <span className="small muted">
                    {formatBlockTime(b.start, b.end)} · {formatDuration(blockMinutes(b))}
                  </span>
                </div>
                <div className="ls-session-what small">
                  {(b.kind ?? 'work') === 'break' ? <span className="muted">Break</span> : null}
                  {task ? <span>{task.title}</span> : b.title ? <span>{b.title}</span> : null}
                  {b.description ? <span className="muted"> — {b.description}</span> : null}
                  {status === 'done' ? (
                    <span className="badge success">
                      <Icon name="check" size={12} /> Done
                    </span>
                  ) : status === 'skipped' ? (
                    <span className="badge">Skipped</span>
                  ) : past ? (
                    <span className="badge warning">Did you do it?</span>
                  ) : null}
                  {b.locked ? (
                    <span className="badge" title="Pinned">
                      <Icon name="lock" size={12} />
                      <span className="visually-hidden">Pinned</span>
                    </span>
                  ) : null}
                </div>
                <div className="ls-session-actions">
                  {status === 'planned' ? (
                    <>
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => setStatus(b, 'done')}
                        aria-label={`Mark session on ${valid ? formatLdt(b.start, year) : ''} done`}
                      >
                        <Icon name="check" size={14} /> Done
                      </button>
                      <button
                        type="button"
                        className="btn small ghost"
                        onClick={() => setStatus(b, 'skipped')}
                        aria-label={`Mark session on ${valid ? formatLdt(b.start, year) : ''} skipped`}
                      >
                        Skip
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn small ghost" onClick={() => setStatus(b, 'planned')}>
                      <Icon name="undo" size={14} /> Reopen
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn small ghost icon"
                    onClick={() => editors.open({ kind: 'block', id: b.id })}
                    aria-label="Edit session"
                    title="Edit session"
                  >
                    <Icon name="edit" size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
