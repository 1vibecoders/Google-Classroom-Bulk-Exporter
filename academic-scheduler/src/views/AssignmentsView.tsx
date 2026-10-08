// Assignment view: "What is due, how much is left, and is it scheduled?"
// Upcoming work first (soonest deadline), grouped (Overdue, This week, Later,
// No date, Done) or by class; filters; workload totals (§ 8.1); one-click
// done; expandable details; "Plan unscheduled work" (a fixed rule, not AI).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ASSIGNMENT_TYPES, ASSIGNMENT_TYPE_LABELS, WORK_STATUSES, WORK_STATUS_LABELS } from '../model/constants';
import type { AssignmentType } from '../model/types';
import { useDoc } from '../state/store';
import { useEditors } from '../editors/EditorHost';
import { navigate, routeToHash } from '../router';
import { useNow } from '../ui/hooks';
import { Icon } from '../ui/Icon';
import { EmptyState } from '../ui/common';
import { formatDateShort, formatDuration } from '../lib/time';
import { workloadTotals, type WorkloadSummary } from '../lib/workload';
import { DEFAULT_FILTER, NO_CLASS, buildRows, groupRows, matchesFilter, type AssignmentFilter, type GroupBy, type StatusFilter } from './lists/assignmentModel';
import { AssignmentCard } from './lists/AssignmentCard';
import { plural } from './lists/format';
import { PlanDialog } from './PlanDialog';
import '../styles/lists.css';

const GROUP_KEY = 'academic-scheduler:assignments-group-by';

function readGroupBy(): GroupBy {
  try {
    return window.localStorage.getItem(GROUP_KEY) === 'class' ? 'class' : 'deadline';
  } catch {
    return 'deadline';
  }
}

function Tile({ label, value, note, tone, children }: { label: string; value: string; note?: string; tone?: 'danger' | 'warning'; children?: ReactNode }) {
  return (
    <div className={`ls-tile${tone ? ` is-${tone}` : ''}`}>
      <div className="ls-tile-label">{label}</div>
      <div className="ls-tile-value">{value}</div>
      {note ? <div className="ls-tile-note">{note}</div> : null}
      {children}
    </div>
  );
}

function countNote(summary: WorkloadSummary): string {
  const parts = [plural(summary.assignments, 'assignment')];
  if (summary.unestimated) parts.push(`${summary.unestimated} without an estimate`);
  return parts.join(' · ');
}

export function AssignmentsView({ classId }: { classId?: string }) {
  const doc = useDoc();
  const now = useNow();
  const editors = useEditors();
  const [filter, setFilter] = useState<AssignmentFilter>(() => ({ ...DEFAULT_FILTER, classId: classId ?? '' }));
  const [groupBy, setGroupByState] = useState<GroupBy>(readGroupBy);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  /** undefined: closed; null: plan everything; array: plan these assignments. */
  const [plan, setPlan] = useState<string[] | null | undefined>(undefined);

  // The route (#/assignments/<classId>) selects the class.
  useEffect(() => {
    setFilter((f) => (f.classId === (classId ?? '') || (f.classId === NO_CLASS && !classId) ? f : { ...f, classId: classId ?? '' }));
  }, [classId]);

  const setGroupBy = (value: GroupBy) => {
    setGroupByState(value);
    try {
      window.localStorage.setItem(GROUP_KEY, value);
    } catch {
      /* not remembered */
    }
  };

  const setClassFilter = (value: string) => {
    setFilter((f) => ({ ...f, classId: value }));
    if (value !== NO_CLASS) navigate(value ? { name: 'assignments', classId: value } : { name: 'assignments' });
  };

  const rows = useMemo(() => buildRows(doc, now), [doc, now]);
  const visible = useMemo(() => rows.filter((r) => matchesFilter(r, filter)), [rows, filter]);
  const groups = useMemo(() => groupRows(visible, groupBy, doc.classes), [visible, groupBy, doc.classes]);

  const classIds = useMemo(() => new Set(doc.classes.map((c) => c.id)), [doc.classes]);
  const selectedClass = filter.classId && filter.classId !== NO_CLASS ? doc.classes.find((c) => c.id === filter.classId) : undefined;
  const unknownClass = !!filter.classId && filter.classId !== NO_CLASS && !selectedClass;

  // Totals follow the class filter (not the status/search filters).
  const totals = useMemo(() => {
    if (!filter.classId) return workloadTotals(doc, now);
    const assignments = doc.assignments.filter((a) => (filter.classId === NO_CLASS ? !a.classId || !classIds.has(a.classId) : a.classId === filter.classId));
    return workloadTotals({ ...doc, assignments }, now);
  }, [doc, now, filter.classId, classIds]);

  const year = Number(now.slice(0, 4));
  const scopeText = selectedClass ? ` for ${selectedClass.name}` : filter.classId === NO_CLASS ? ' without a class' : '';
  const filtersActive = filter.query !== '' || filter.status !== 'open' || filter.type !== '' || filter.classId !== '';

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const classOptions = doc.classes.filter((c) => !c.archived || c.id === filter.classId).sort((a, b) => a.name.localeCompare(b.name));
  const openCount = rows.filter((r) => r.assignment.status !== 'done' && r.assignment.status !== 'cancelled').length;

  return (
    <div className="lists-page">
      <div className="page-header">
        <div>
          <h1>Assignments</h1>
          <div className="page-subtitle">Upcoming work by deadline: what is left to do and whether it is scheduled.</div>
        </div>
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => setPlan(null)} disabled={doc.assignments.length === 0}>
          <Icon name="wand" />
          Plan unscheduled work
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => editors.open({ kind: 'assignment', initial: selectedClass ? { classId: selectedClass.id } : undefined })}
        >
          <Icon name="plus" />
          New assignment
        </button>
      </div>

      {doc.assignments.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No assignments yet"
            actions={
              <>
                <button type="button" className="btn primary" onClick={() => editors.open({ kind: 'assignment' })}>
                  <Icon name="plus" /> Add an assignment
                </button>
                <a className="btn" href={routeToHash({ name: 'import' })}>
                  <Icon name="upload" /> Import a schedule
                </a>
              </>
            }
          >
            Add homework, projects, readings and tests with their due dates and how long they will take — or import a schedule made by /academic-schedule.
          </EmptyState>
        </div>
      ) : (
        <>
          <section className="ls-totals" aria-label={`Workload totals${scopeText}`}>
            <Tile
              label={`Due this week${scopeText}`}
              value={`${formatDuration(totals.thisWeek.remainingMinutes)} left`}
              note={`${countNote(totals.thisWeek)} · through ${formatDateShort(totals.weekEnd, year)}`}
            />
            <Tile label={`All remaining work${scopeText}`} value={`${formatDuration(totals.overall.remainingMinutes)}`} note={countNote(totals.overall)} />
            <Tile
              label="Not yet scheduled"
              value={formatDuration(totals.overall.unscheduledMinutes)}
              note={`${formatDuration(totals.overall.scheduledMinutes)} already scheduled`}
              tone={totals.overall.unscheduledMinutes > 0 ? 'warning' : undefined}
            >
              {totals.overall.unscheduledMinutes > 0 ? (
                <button type="button" className="btn small ls-tile-action" onClick={() => setPlan(null)}>
                  <Icon name="wand" size={14} /> Plan it
                </button>
              ) : null}
            </Tile>
            <Tile
              label="Overdue"
              value={plural(totals.overdue.assignments, 'assignment')}
              note={totals.overdue.assignments ? `${formatDuration(totals.overdue.remainingMinutes)} of work left` : 'Nothing overdue'}
              tone={totals.overdue.assignments ? 'danger' : undefined}
            />
          </section>

          <div className="ls-toolbar card" role="search" aria-label="Filter assignments">
            <div className="field ls-search">
              <label htmlFor="asg-search">Search</label>
              <input
                id="asg-search"
                className="input"
                type="search"
                placeholder="Title, class, topic, subtask…"
                value={filter.query}
                onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="asg-class">Class</label>
              <select id="asg-class" className="select" value={filter.classId} onChange={(e) => setClassFilter(e.target.value)}>
                <option value="">All classes</option>
                {classOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.archived ? ' (archived)' : ''}
                  </option>
                ))}
                {unknownClass ? <option value={filter.classId}>Unknown class</option> : null}
                <option value={NO_CLASS}>No class</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="asg-status">Status</label>
              <select
                id="asg-status"
                className="select"
                value={filter.status}
                onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value as StatusFilter }))}
              >
                <option value="open">Not done yet</option>
                <option value="all">All, including done</option>
                {WORK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {WORK_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="asg-type">Type</label>
              <select
                id="asg-type"
                className="select"
                value={filter.type}
                onChange={(e) => setFilter((f) => ({ ...f, type: e.target.value as AssignmentType | '' }))}
              >
                <option value="">All types</option>
                {ASSIGNMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ASSIGNMENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <span className="field-label" id="asg-group-label">
                Group by
              </span>
              <div className="ls-segmented" role="group" aria-labelledby="asg-group-label">
                <button type="button" aria-pressed={groupBy === 'deadline'} onClick={() => setGroupBy('deadline')}>
                  Deadline
                </button>
                <button type="button" aria-pressed={groupBy === 'class'} onClick={() => setGroupBy('class')}>
                  Class
                </button>
              </div>
            </div>
            {filtersActive ? (
              <button
                type="button"
                className="btn ghost small ls-clear"
                onClick={() => {
                  setFilter(DEFAULT_FILTER);
                  if (classId) navigate({ name: 'assignments' });
                }}
              >
                <Icon name="x" size={14} /> Clear filters
              </button>
            ) : null}
          </div>

          <p className="small muted ls-count" aria-live="polite">
            Showing {visible.length} of {plural(rows.length, 'assignment')}
            {filter.status === 'open' && rows.length > openCount ? ` (${rows.length - openCount} done or cancelled hidden)` : ''}.
          </p>

          {unknownClass ? (
            <div className="banner warning" role="status">
              <Icon name="warning" />
              <span>
                This class no longer exists. <a href={routeToHash({ name: 'assignments' })}>Show all assignments</a>
              </span>
            </div>
          ) : null}

          {groups.length === 0 ? (
            <div className="card">
              {filter.status === 'open' && !filter.query && !filter.type && openCount === 0 && !filter.classId ? (
                <EmptyState
                  title="All caught up"
                  actions={
                    <button type="button" className="btn" onClick={() => setFilter((f) => ({ ...f, status: 'all' }))}>
                      Show done work
                    </button>
                  }
                >
                  Every assignment is done or cancelled.
                </EmptyState>
              ) : (
                <EmptyState
                  title="No assignments match"
                  actions={
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setFilter(DEFAULT_FILTER);
                        if (classId) navigate({ name: 'assignments' });
                      }}
                    >
                      Clear filters
                    </button>
                  }
                >
                  Try another search, class, status or type.
                </EmptyState>
              )}
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.key} className={`ls-group ls-group-${group.key}`} aria-labelledby={`grp-${group.key}`}>
                <div className="ls-group-head">
                  {group.color ? <span className="class-dot" style={{ background: group.color }} aria-hidden="true" /> : null}
                  <h2 id={`grp-${group.key}`}>
                    {group.label} <span className="ls-group-count">{group.rows.length}</span>
                  </h2>
                  {group.remainingMinutes > 0 ? <span className="small muted">{formatDuration(group.remainingMinutes)} left</span> : null}
                  {group.hint ? <span className="small muted ls-group-hint">{group.hint}</span> : null}
                </div>
                <ul className="ls-asg-list">
                  {group.rows.map((row) => (
                    <AssignmentCard
                      key={row.assignment.id}
                      row={row}
                      doc={doc}
                      now={now}
                      expanded={expanded.has(row.assignment.id)}
                      onToggle={() => toggle(row.assignment.id)}
                      onPlan={(ids) => setPlan(ids)}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}

      {plan !== undefined ? <PlanDialog assignmentIds={plan ?? undefined} onClose={() => setPlan(undefined)} /> : null}
    </div>
  );
}
