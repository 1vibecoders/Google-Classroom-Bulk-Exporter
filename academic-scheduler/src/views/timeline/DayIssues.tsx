// Issues that concern a day (root issues and item issues with that `date`,
// § 5 Issue): open ones with Resolve / Dismiss, closed ones collapsed with
// Reopen. The issue text is shown as plain text, never as HTML.
import { useId } from 'react';
import type { DayIssue } from '../../lib/calendar';
import { ISSUE_KIND_LABELS, ISSUE_STATUS_LABELS } from '../../model/constants';
import type { DateStr, IssueStatus, ScheduleDocument } from '../../model/types';
import { formatDateWithWeekday } from '../../lib/time';
import { Icon } from '../../ui/Icon';
import { findItem, type ItemRef } from './logic';

export interface DatedIssue extends DayIssue {
  /** The day it was found on (shown when issues of several days are listed). */
  day?: DateStr;
}

interface DayIssuesProps {
  doc: ScheduleDocument;
  issues: DatedIssue[];
  onStatus: (issue: DayIssue, status: IssueStatus) => void;
  onOpenItem: (item: ItemRef) => void;
  title?: string;
  showDates?: boolean;
}

function statusOf(issue: DayIssue): IssueStatus {
  return issue.issue.status ?? 'open';
}

export function DayIssues({ doc, issues, onStatus, onOpenItem, title = 'Issues', showDates = false }: DayIssuesProps) {
  const headingId = useId();
  if (issues.length === 0) return null;
  const open = issues.filter((i) => statusOf(i) === 'open');
  const closed = issues.filter((i) => statusOf(i) !== 'open');
  return (
    <section className="card day-issues" aria-labelledby={headingId}>
      <div className="card-header">
        <Icon name="warning" />
        <h2 id={headingId}>
          {title}
          {open.length ? <span className="muted"> ({open.length} open)</span> : null}
        </h2>
      </div>
      <div className="card-body stack">
        {open.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Nothing open. Well done.</p> : null}
        {open.length ? (
          <ul className="di-list">
            {open.map((i) => (
              <IssueRow key={keyOf(i)} doc={doc} item={i} onStatus={onStatus} onOpenItem={onOpenItem} showDate={showDates} />
            ))}
          </ul>
        ) : null}
        {closed.length ? (
          <details className="di-closed">
            <summary>
              {closed.length} resolved or dismissed
            </summary>
            <ul className="di-list">
              {closed.map((i) => (
                <IssueRow key={keyOf(i)} doc={doc} item={i} onStatus={onStatus} onOpenItem={onOpenItem} showDate={showDates} />
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </section>
  );
}

function keyOf(i: DatedIssue): string {
  return `${i.scope ? `${i.scope.collection}:${i.scope.id}` : 'root'}:${i.index}`;
}

function IssueRow({ doc, item, onStatus, onOpenItem, showDate }: { doc: ScheduleDocument; item: DatedIssue; onStatus: DayIssuesProps['onStatus']; onOpenItem: DayIssuesProps['onOpenItem']; showDate: boolean }) {
  const { issue } = item;
  const status = statusOf(item);
  const about = findItem(doc, item.itemId);
  const tone = issue.kind === 'workload' || issue.kind === 'conflict' ? 'warning' : '';
  return (
    <li className={`di-issue${status !== 'open' ? ' is-closed' : ''}`}>
      <div className="row di-head">
        <span className={`badge ${tone}`}>{ISSUE_KIND_LABELS[issue.kind] ?? 'Note'}</span>
        {status !== 'open' ? <span className="badge success">{ISSUE_STATUS_LABELS[status]}</span> : null}
        {showDate && item.day ? <span className="muted small">{formatDateWithWeekday(item.day)}</span> : null}
        {issue.field ? <span className="muted small">Field: {issue.field}</span> : null}
      </div>
      <p className="di-message">{issue.message}</p>
      <div className="row di-actions">
        {about ? (
          <button type="button" className="btn ghost small di-about" onClick={() => onOpenItem(about)}>
            About: {about.title}
          </button>
        ) : null}
        <span className="spacer" />
        {status === 'open' ? (
          <>
            <button type="button" className="btn small" onClick={() => onStatus(item, 'resolved')}>
              <Icon name="check" size={14} />
              Resolve
            </button>
            <button type="button" className="btn small ghost" onClick={() => onStatus(item, 'dismissed')}>
              Dismiss
            </button>
          </>
        ) : (
          <button type="button" className="btn small ghost" onClick={() => onStatus(item, 'open')}>
            <Icon name="undo" size={14} />
            Reopen
          </button>
        )}
      </div>
    </li>
  );
}
