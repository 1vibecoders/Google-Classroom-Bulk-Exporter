// Classes view: one card per class with its color, teacher, description,
// counts (open assignments, remaining work, next deadline), topics, class
// materials (references) and issues; create, edit and delete (asking what
// happens to the class's assignments and events).
import { useMemo, useState } from 'react';
import { ASSIGNMENT_TYPE_LABELS } from '../model/constants';
import type { SchoolClass } from '../model/types';
import { useDoc } from '../state/store';
import { useEditors } from '../editors/EditorHost';
import { routeToHash } from '../router';
import { useNow } from '../ui/hooks';
import { Icon } from '../ui/Icon';
import { Menu } from '../ui/Menu';
import { EmptyState } from '../ui/common';
import { classColorMap } from '../lib/calendar';
import { dateOf, formatDuration } from '../lib/time';
import { classStats, type ClassStats } from './lists/classModel';
import { DeleteClassDialog } from './lists/DeleteClassDialog';
import { countOpen, itemIssues } from './lists/assignmentModel';
import { IssuePanel } from './lists/IssuePanel';
import { ControlBadges, ProvenancePanel } from './lists/Provenance';
import { ReferenceList } from './lists/ReferenceList';
import { formatWhen, plural, relativeDays } from './lists/format';
import '../styles/lists.css';

function ClassCard({
  schoolClass,
  color,
  stats,
  now,
  onDelete,
}: {
  schoolClass: SchoolClass;
  color: string;
  stats: ClassStats;
  now: string;
  onDelete: () => void;
}) {
  const doc = useDoc();
  const editors = useEditors();
  const today = now.slice(0, 10);
  const year = Number(today.slice(0, 4));
  const c = schoolClass;
  const issues = itemIssues(doc, 'classes', c);
  const openIssues = countOpen(issues);
  const meta = [c.section, c.room ? `Room ${c.room}` : ''].filter(Boolean).join(' · ');
  const refs = c.references || [];
  const headingId = `cls-${c.id}`;
  const showBadges = !!c.archived || !!c.locked || ((c.origin ?? 'generated') !== 'user' && !!c.overrides?.length) || openIssues > 0;

  return (
    <article className={`card ls-class${c.archived ? ' is-archived' : ''}`} style={{ ['--class-color' as string]: color }} aria-labelledby={headingId}>
      <div className="ls-class-stripe" aria-hidden="true" />
      <div className="card-body stack">
        <header className="ls-class-head">
          <span className="class-dot ls-class-dot" style={{ background: color }} aria-hidden="true" />
          <div className="ls-class-title">
            <h2 id={headingId}>{c.name}</h2>
            {meta ? <div className="small muted">{meta}</div> : null}
          </div>
          <div className="ls-class-actions">
            <button
              type="button"
              className="btn ghost icon small"
              onClick={() => editors.open({ kind: 'class', id: c.id })}
              aria-label={`Edit ${c.name}`}
              title="Edit"
            >
              <Icon name="edit" />
            </button>
            <Menu
              label={<Icon name="menu" />}
              buttonClass="btn ghost icon small"
              ariaLabel={`More actions for ${c.name}`}
              items={[
                { label: 'Add an assignment', icon: 'plus', onSelect: () => editors.open({ kind: 'assignment', initial: { classId: c.id } }) },
                {
                  label: 'Add a class meeting or event',
                  icon: 'calendar',
                  onSelect: () => editors.open({ kind: 'event', initial: { classId: c.id, category: 'class' } }),
                },
                { label: 'Delete class', icon: 'trash', danger: true, onSelect: onDelete },
              ]}
            />
          </div>
        </header>

        {showBadges ? (
          <div className="row">
            {c.archived ? <span className="badge">Archived</span> : null}
            <ControlBadges item={c} />
            {openIssues ? (
              <span className="badge warning">
                <Icon name="warning" size={12} /> {plural(openIssues, 'issue')}
              </span>
            ) : null}
          </div>
        ) : null}

        {c.teacher ? (
          <div className="small">
            <span className="muted">Teacher: </span>
            {c.teacher}
          </div>
        ) : null}
        {c.description ? <p className="ls-text ls-clamp small">{c.description}</p> : null}

        <dl className="ls-class-stats">
          <div>
            <dt>Open assignments</dt>
            <dd>{stats.open}</dd>
          </div>
          <div>
            <dt>Remaining work</dt>
            <dd>
              {formatDuration(stats.remainingMinutes)}
              {stats.unestimated ? <span className="small muted"> + {stats.unestimated} not estimated</span> : null}
            </dd>
          </div>
          <div>
            <dt>Not scheduled</dt>
            <dd className={stats.unscheduledMinutes ? 'ls-unscheduled' : undefined}>{formatDuration(stats.unscheduledMinutes)}</dd>
          </div>
          {stats.overdue ? (
            <div>
              <dt>Overdue</dt>
              <dd className="ls-overdue-text">{stats.overdue}</dd>
            </div>
          ) : null}
        </dl>

        {stats.next ? (
          <div className="small ls-next">
            <span className="muted">Next: </span>
            <strong>{stats.next.assignment.title}</strong>
            {' · '}
            {stats.next.kind === 'due' ? 'due' : (ASSIGNMENT_TYPE_LABELS[stats.next.assignment.type ?? 'test'] ?? 'Assessment').toLowerCase()}{' '}
            {formatWhen(stats.next.value, year)}
            <span className="muted"> ({relativeDays(dateOf(stats.next.value), today)})</span>
          </div>
        ) : null}

        {c.topics && c.topics.length ? (
          <div>
            <h3 className="ls-subhead">Topics</h3>
            <ul className="ls-chips">
              {c.topics.map((t) => (
                <li key={t} className="badge">
                  {t}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {refs.length ? (
          refs.length > 3 ? (
            <details>
              <summary className="ls-subhead">Class materials ({refs.length})</summary>
              <ReferenceList references={refs} />
            </details>
          ) : (
            <div>
              <h3 className="ls-subhead">Class materials</h3>
              <ReferenceList references={refs} />
            </div>
          )
        ) : null}

        <IssuePanel entries={issues} />

        <details className="ls-provenance-details">
          <summary className="small">Source and control</summary>
          <ProvenancePanel item={c} collection="classes" currentYear={year} />
        </details>

        <div className="row ls-class-footer">
          <a className="btn small" href={routeToHash({ name: 'assignments', classId: c.id })}>
            <Icon name="list" size={14} /> View assignments ({stats.assignments})
          </a>
          {stats.events ? <span className="small muted">{plural(stats.events, 'event')}</span> : null}
        </div>
      </div>
    </article>
  );
}

export function ClassesView() {
  const doc = useDoc();
  const now = useNow();
  const editors = useEditors();
  const [deleting, setDeleting] = useState<string | null>(null);
  const stats = useMemo(() => classStats(doc, now), [doc, now]);
  const colors = classColorMap(doc);
  const sorted = useMemo(() => [...doc.classes].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })), [doc.classes]);
  const active = sorted.filter((c) => !c.archived);
  const archived = sorted.filter((c) => c.archived);
  const unassigned = stats.get('');
  const target = deleting ? doc.classes.find((c) => c.id === deleting) : undefined;

  const card = (c: SchoolClass) => (
    <ClassCard key={c.id} schoolClass={c} color={colors.get(c.id) ?? '#64748B'} stats={stats.get(c.id)!} now={now} onDelete={() => setDeleting(c.id)} />
  );

  return (
    <div className="lists-page">
      <div className="page-header">
        <div>
          <h1>Classes</h1>
          <div className="page-subtitle">Your courses, their materials and how much work is left in each.</div>
        </div>
        <span className="spacer" />
        <button type="button" className="btn primary" onClick={() => editors.open({ kind: 'class' })}>
          <Icon name="plus" /> New class
        </button>
      </div>

      {doc.classes.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No classes yet"
            actions={
              <>
                <button type="button" className="btn primary" onClick={() => editors.open({ kind: 'class' })}>
                  <Icon name="plus" /> Add a class
                </button>
                <a className="btn" href={routeToHash({ name: 'import' })}>
                  <Icon name="upload" /> Import a schedule
                </a>
              </>
            }
          >
            Add each course with its teacher and a color. Assignments and class meetings can then be linked to it.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="ls-class-grid">{active.map(card)}</div>
          {archived.length ? (
            <section className="ls-archived" aria-labelledby="archived-classes">
              <h2 id="archived-classes" className="ls-section-title">
                Archived classes <span className="ls-group-count">{archived.length}</span>
              </h2>
              <p className="small muted">Archived classes are hidden from pickers and filters; their assignments still appear.</p>
              <div className="ls-class-grid">{archived.map(card)}</div>
            </section>
          ) : null}
        </>
      )}

      {unassigned && unassigned.assignments > 0 ? (
        <p className="small muted ls-unassigned">
          {plural(unassigned.assignments, 'assignment')} without a class ({unassigned.open} open, {formatDuration(unassigned.remainingMinutes)} left).{' '}
          <a href={routeToHash({ name: 'assignments' })}>See all assignments</a>
        </p>
      ) : null}

      {target ? <DeleteClassDialog schoolClass={target} stats={stats.get(target.id)!} onClose={() => setDeleting(null)} /> : null}
    </div>
  );
}
