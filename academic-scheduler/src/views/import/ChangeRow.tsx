// One row of the import preview: the item, what happens to it, the fields
// that change (before → after), why, what goes with it, and — for rows the
// person can choose — a checkbox. All text comes from the plan and is shown
// as text only.
import { useId } from 'react';
import type { ImportChange } from '../../lib/importDiff';
import { Icon, type IconName } from '../../ui/Icon';
import { actionLabel, isToggleable, kindLabel } from './logic';

/** Show at most this many items that go with a row. */
const INCLUDES_LIMIT = 8;

const SIGNS: Partial<Record<ImportChange['category'], { icon: IconName; text: string }>> = {
  new: { icon: 'plus', text: 'Will be added' },
  updated: { icon: 'edit', text: 'Will be updated' },
  removedFromSource: { icon: 'edit', text: 'Will be updated' },
  unchanged: { icon: 'check', text: 'No change' },
  protected: { icon: 'lock', text: 'Always kept' },
  kept: { icon: 'lock', text: 'Your version is kept' },
};

export interface ChangeRowProps {
  row: ImportChange;
  chosen: boolean;
  onToggle: (key: string, value: boolean) => void;
  /** Problems of the merged schedule caused by this row (live, for the current choices). */
  problems?: string[];
  /** The assignment a task row belongs to. */
  parentLabel?: string;
  /** "This session has passed — did you do it?": the current block can still be marked done or skipped. */
  onMarkPassed?: (status: 'done' | 'skipped') => void;
}

export function ChangeRow({ row, chosen, onToggle, problems, parentLabel, onMarkPassed }: ChangeRowProps) {
  const id = useId();
  const describedBy = `${id}-desc`;
  const toggleable = isToggleable(row);
  const sign = SIGNS[row.category] ?? { icon: row.blockedReason ? 'lock' : 'info', text: row.blockedReason ? 'Cannot be chosen' : 'Follows another row' };
  const includes = row.includes ?? [];
  const shownIncludes = includes.slice(0, INCLUDES_LIMIT);
  const removing = toggleable && chosen && row.removes;

  return (
    <li className={`imp-row${toggleable ? ' toggleable' : ''}${chosen ? ' chosen' : ''}${removing ? ' removing' : ''}${problems?.length ? ' has-problem' : ''}`}>
      <div className="imp-row-control">
        {toggleable ? (
          <input id={id} type="checkbox" checked={chosen} onChange={(e) => onToggle(row.key, e.target.checked)} aria-describedby={describedBy} />
        ) : (
          <span className={`imp-sign cat-${row.category}`} title={sign.text}>
            <Icon name={sign.icon} size={14} />
            <span className="visually-hidden">{sign.text}: </span>
          </span>
        )}
      </div>
      <div className="imp-row-body">
        {toggleable ? (
          <label htmlFor={id} className="imp-row-title">
            <span className={`imp-action${row.removes ? ' remove' : ''}`}>{actionLabel(row)}</span>
            <span className="imp-kind">{kindLabel(row)}</span>
            <span className="imp-label">{row.label}</span>
          </label>
        ) : (
          <div className="imp-row-title">
            <span className="imp-kind">{kindLabel(row)}</span>
            <span className="imp-label">{row.label}</span>
          </div>
        )}
        <div id={describedBy} className="imp-row-desc">
          {parentLabel ? <div className="small muted">Task of “{parentLabel}”</div> : null}
          {row.detail ? <div className="small muted imp-detail">{row.detail}</div> : null}
          {row.fields.length ? (
            <ul className="imp-fields">
              {row.fields.map((f, i) => (
                <li key={`${f.field}-${i}`}>
                  <span className="imp-field-label">{f.label ?? f.field}:</span> <span className="imp-before">{f.before}</span>
                  <span className="imp-arrow" aria-hidden="true">
                    {' '}
                    →{' '}
                  </span>
                  <span className="visually-hidden"> becomes </span>
                  <span className="imp-after">{f.after}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {row.reason ? <div className="small imp-reason">{row.reason}</div> : null}
          {row.requestedByPerson ? (
            <div>
              <span className="badge accent">You asked for this change</span>
            </div>
          ) : null}
          {row.neverSet ? (
            <div>
              <span className="badge">You never set this (default in use)</span>
            </div>
          ) : null}
          {includes.length ? (
            <div className="small imp-includes">
              <span className="imp-includes-label">{row.removes || row.category === 'removedFromSource' ? 'Removed together with it:' : 'Goes together with it:'}</span>{' '}
              {shownIncludes.map((inc) => inc.label).join('; ')}
              {includes.length > shownIncludes.length ? `; and ${includes.length - shownIncludes.length} more` : ''}
            </div>
          ) : null}
          {row.blockedReason ? (
            <div className="small imp-blocked">
              <Icon name="lock" size={12} /> <span>Can’t be chosen: {row.blockedReason}</span>
            </div>
          ) : null}
        </div>
        {row.passed && onMarkPassed ? (
          <div className="imp-passed">
            <span>
              <Icon name="clock" size={14} /> This session has passed — did you do it?
            </span>
            <span className="row">
              <button type="button" className="btn small" onClick={() => onMarkPassed('done')} aria-label={`Mark “${row.label}” done`}>
                <Icon name="check" size={14} /> Mark done
              </button>
              <button type="button" className="btn small ghost" onClick={() => onMarkPassed('skipped')} aria-label={`Mark “${row.label}” skipped`}>
                Skipped
              </button>
            </span>
          </div>
        ) : null}
        {problems?.length ? (
          <ul className="imp-row-problems" aria-label="Problems with this change">
            {problems.map((p, i) => (
              <li key={i}>
                <Icon name="warning" size={12} /> <span>{p}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}
