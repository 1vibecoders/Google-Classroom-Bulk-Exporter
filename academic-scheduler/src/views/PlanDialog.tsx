// "Plan unscheduled work": runs the website's fixed planning rule
// (src/lib/planner.ts — earliest deadline first into the person's free study
// time; no AI), previews the proposed sessions per day, lists the work that
// does not fit with the reason, and adds only the sessions the person keeps
// (origin "planner").
import { useMemo, useState } from 'react';
import { resolveSettings } from '../model/constants';
import type { ScheduleBlock } from '../model/types';
import { useStore } from '../state/store';
import { useEditors } from '../editors/EditorHost';
import { classColor } from '../lib/calendar';
import { DEFAULT_HORIZON_DAYS, describePlannerRules, planUnscheduledWork } from '../lib/planner';
import { formatDateWithWeekday, formatDuration, nowLocal } from '../lib/time';
import { blockMinutes } from '../lib/workload';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { ClassChip } from '../ui/common';
import { formatBlockTime, plural } from './lists/format';
import '../styles/lists.css';

export interface PlanDialogProps {
  /** Plan only these assignments (default: everything with unscheduled work). */
  assignmentIds?: string[];
  onClose: () => void;
}

const HORIZONS = [
  { days: 7, label: 'Next 7 days' },
  { days: 14, label: 'Next 2 weeks' },
  { days: DEFAULT_HORIZON_DAYS, label: 'Next 4 weeks' },
  { days: 56, label: 'Next 8 weeks' },
];

export function PlanDialog({ assignmentIds, onClose }: PlanDialogProps) {
  const { state, dispatch, notify } = useStore();
  const editors = useEditors();
  const doc = state.doc;
  const [from] = useState(() => nowLocal());
  const [horizon, setHorizon] = useState(DEFAULT_HORIZON_DAYS);
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const settings = resolveSettings(doc.settings);
  const year = Number(from.slice(0, 4));

  const result = useMemo(() => planUnscheduledWork(doc, { from, assignmentIds, horizonDays: horizon }), [doc, from, assignmentIds, horizon]);
  const assignments = useMemo(() => new Map(doc.assignments.map((a) => [a.id, a] as const)), [doc.assignments]);
  const classes = useMemo(() => new Map(doc.classes.map((c) => [c.id, c] as const)), [doc.classes]);

  const byDay = useMemo(() => {
    const map = new Map<string, ScheduleBlock[]>();
    for (const b of result.blocks) {
      const day = b.start.slice(0, 10);
      const list = map.get(day);
      if (list) list.push(b);
      else map.set(day, [b]);
    }
    return [...map.entries()];
  }, [result.blocks]);

  const kept = result.blocks.filter((b) => !excluded.has(b.id));
  const keptMinutes = kept.reduce((sum, b) => sum + blockMinutes(b), 0);
  const noAvailability = doc.availability.length === 0;
  const single = assignmentIds && assignmentIds.length === 1 ? assignments.get(assignmentIds[0]) : undefined;

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const add = () => {
    if (kept.length === 0) return;
    const ids = kept.map((b) => b.id);
    dispatch({ type: 'addBlocks', items: kept });
    notify(`Added ${plural(kept.length, 'work session')} (${formatDuration(keptMinutes)}) to your schedule.`, {
      tone: 'success',
      action: { label: 'Undo', run: () => dispatch({ type: 'deleteBlocks', ids, now: nowLocal() }) },
    });
    onClose();
  };

  const titleOf = (b: ScheduleBlock) => {
    const a = b.assignmentId ? assignments.get(b.assignmentId) : undefined;
    const task = a && b.taskId ? (a.tasks || []).find((t) => t.id === b.taskId) : undefined;
    return { a, task, cls: a?.classId ? classes.get(a.classId) : undefined };
  };

  return (
    <Modal
      title={single ? `Plan “${single.title}”` : 'Plan unscheduled work'}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <span className="left small muted" aria-live="polite">
            {result.blocks.length ? `${kept.length} of ${result.blocks.length} selected · ${formatDuration(keptMinutes)}` : null}
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={add} disabled={kept.length === 0}>
            <Icon name="plus" />
            {kept.length ? `Add ${plural(kept.length, 'session')}` : 'Add sessions'}
          </button>
        </>
      }
    >
      <div className="stack plan-dialog">
        <div className="plan-rule">
          <p style={{ margin: 0 }}>
            <strong>A fixed rule, not AI:</strong> earliest deadline first, into your free study time. Nothing you already planned is moved. Review the proposed
            sessions below; only the ones you keep are added.
          </p>
          <details>
            <summary>How the plan is made</summary>
            <ul className="small">
              {describePlannerRules(settings, horizon).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="small muted" style={{ margin: 0 }}>
              Session length, breaks and the daily limit come from Settings.
            </p>
          </details>
        </div>

        <div className="row">
          <label className="small muted" htmlFor="plan-horizon">
            Plan within
          </label>
          <select id="plan-horizon" className="select plan-horizon" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
            {HORIZONS.map((h) => (
              <option key={h.days} value={h.days}>
                {h.label}
              </option>
            ))}
          </select>
        </div>

        {noAvailability ? (
          <div className="banner warning" role="status">
            <Icon name="warning" />
            <div className="stack" style={{ gap: 6 }}>
              <span>You have not entered any study time yet, so there is no free time to plan into.</span>
              <div>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    onClose();
                    editors.open({ kind: 'availability' });
                  }}
                >
                  <Icon name="plus" size={14} /> Add study time
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {result.blocks.length === 0 && result.unplaced.length === 0 ? (
          <div className="empty" style={{ padding: '20px 8px' }}>
            <h3>Nothing to plan</h3>
            <p style={{ margin: 0 }}>All estimated work that counts is already scheduled.</p>
          </div>
        ) : null}

        {result.blocks.length === 0 && result.unplaced.length > 0 ? (
          <p className="small" style={{ margin: 0 }}>
            No sessions could be placed. The reasons are listed below.
          </p>
        ) : null}

        {byDay.length ? (
          <section aria-labelledby="plan-proposed">
            <h3 id="plan-proposed" className="ls-subhead">
              Proposed sessions
            </h3>
            <div className="plan-days">
              {byDay.map(([day, blocks]) => (
                <div key={day} className="plan-day">
                  <h4 className="plan-day-title">
                    {formatDateWithWeekday(day, year)}
                    <span className="small muted"> · {formatDuration(blocks.reduce((s, b) => s + blockMinutes(b), 0))}</span>
                  </h4>
                  <ul className="plan-blocks">
                    {blocks.map((b) => {
                      const { a, task, cls } = titleOf(b);
                      const checked = !excluded.has(b.id);
                      return (
                        <li key={b.id} className={checked ? undefined : 'is-excluded'}>
                          <label className="plan-block">
                            <input type="checkbox" checked={checked} onChange={() => toggle(b.id)} />
                            <span className="plan-block-body">
                              <span className="plan-block-time">
                                {formatBlockTime(b.start, b.end)} · {formatDuration(blockMinutes(b))}
                              </span>
                              <span className="plan-block-what">
                                {cls ? <ClassChip name={cls.name} color={classColor(doc, cls.id)} /> : null}
                                <strong>{a?.title ?? b.title ?? 'Work'}</strong>
                                {task ? <span className="muted">{task.title}</span> : null}
                              </span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {result.unplaced.length ? (
          <section aria-labelledby="plan-unplaced">
            <h3 id="plan-unplaced" className="ls-subhead">
              Not planned
            </h3>
            <ul className="plan-unplaced">
              {result.unplaced.map((u, i) => {
                const a = assignments.get(u.assignmentId);
                const task = a && u.taskId ? (a.tasks || []).find((t) => t.id === u.taskId) : undefined;
                return (
                  <li key={`${u.assignmentId}:${u.taskId ?? ''}:${i}`}>
                    <Icon name="info" size={14} />
                    <div>
                      <strong>{a?.title ?? u.assignmentId}</strong>
                      {task ? <span className="muted"> · {task.title}</span> : null}
                      {u.minutes > 0 ? <span className="muted"> · {formatDuration(u.minutes)}</span> : null}
                      <div className="small">{u.reason}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
