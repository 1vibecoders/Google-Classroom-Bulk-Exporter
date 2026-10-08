// Issues about an item, with Resolve / Dismiss / Reopen (§ 5 Issue: the
// status is person-owned). Messages are plain text, never HTML.
import { useCallback } from 'react';
import { ISSUE_KIND_LABELS, ISSUE_STATUS_LABELS } from '../../model/constants';
import type { Issue, IssueStatus } from '../../model/types';
import { useStore } from '../../state/store';
import { newId } from '../../lib/ids';
import { nowLocal } from '../../lib/time';
import { Icon } from '../../ui/Icon';
import { issueIds, type IssueEntry } from './assignmentModel';

function withoutStatus(issue: Issue): Issue {
  const copy = { ...issue };
  delete copy.status;
  return copy;
}

/** Change the status of an issue wherever it is stored. */
export function useIssueStatus(): (entry: IssueEntry, status: IssueStatus) => void {
  const { state, dispatch } = useStore();
  const doc = state.doc;
  return useCallback(
    (entry: IssueEntry, status: IssueStatus) => {
      const newIssueId = newId('iss', issueIds(doc));
      const holder = entry.holder;
      if (holder.kind === 'root') {
        dispatch({ type: 'setIssueStatus', scope: null, index: entry.index, status, newIssueId });
      } else if (holder.kind === 'item') {
        dispatch({ type: 'setIssueStatus', scope: { collection: holder.collection, id: holder.id }, index: entry.index, status, newIssueId });
      } else {
        // Task issues: the reducer's issue scopes are top-level items, so the
        // task is updated through its assignment. Issue status is person-owned
        // and never recorded in `overrides`.
        const assignment = doc.assignments.find((a) => a.id === holder.assignmentId);
        if (!assignment) return;
        const tasks = (assignment.tasks || []).map((task) => {
          if (task.id !== holder.taskId) return task;
          const issues = (task.issues || []).map((issue, i) => {
            if (i !== entry.index) return issue;
            return status === 'open' ? withoutStatus(issue) : { ...issue, id: issue.id ?? newIssueId, status };
          });
          return { ...task, issues };
        });
        dispatch({ type: 'upsertAssignment', item: { ...assignment, tasks }, now: nowLocal() });
      }
    },
    [doc, dispatch],
  );
}

function statusOf(issue: Issue): IssueStatus {
  return issue.status ?? 'open';
}

function IssueItem({ entry, onStatus }: { entry: IssueEntry; onStatus: (entry: IssueEntry, status: IssueStatus) => void }) {
  const { issue } = entry;
  const status = statusOf(issue);
  const tone = issue.kind === 'conflict' || issue.kind === 'workload' ? 'warning' : 'accent';
  return (
    <li className={`ls-issue${status !== 'open' ? ' is-closed' : ''}`}>
      <div className="ls-issue-head">
        <span className={`badge ${status === 'open' ? tone : ''}`}>
          <Icon name={status === 'open' ? 'warning' : 'check'} size={12} />
          {ISSUE_KIND_LABELS[issue.kind] ?? 'Note'}
        </span>
        {entry.context ? <span className="small muted">{entry.context}</span> : null}
        {issue.field ? <span className="small muted">Field: {issue.field}</span> : null}
        {status !== 'open' ? <span className="small muted">{ISSUE_STATUS_LABELS[status]}</span> : null}
      </div>
      <p className="ls-issue-message">{issue.message}</p>
      <div className="row ls-issue-actions">
        {status === 'open' ? (
          <>
            <button type="button" className="btn small" onClick={() => onStatus(entry, 'resolved')}>
              <Icon name="check" size={14} /> Resolve
            </button>
            <button type="button" className="btn small ghost" onClick={() => onStatus(entry, 'dismissed')}>
              Dismiss
            </button>
          </>
        ) : (
          <button type="button" className="btn small ghost" onClick={() => onStatus(entry, 'open')}>
            <Icon name="undo" size={14} /> Reopen
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * Open issues first (with Resolve / Dismiss), resolved and dismissed ones in a
 * collapsed list (with Reopen). Renders nothing when there are none.
 */
export function IssuePanel({ entries, title = 'Issues' }: { entries: IssueEntry[]; title?: string }) {
  const setStatus = useIssueStatus();
  if (entries.length === 0) return null;
  const open = entries.filter((e) => statusOf(e.issue) === 'open');
  const closed = entries.filter((e) => statusOf(e.issue) !== 'open');
  const key = (e: IssueEntry) => `${e.holder.kind}:${'id' in e.holder ? e.holder.id : 'taskId' in e.holder ? e.holder.taskId : 'root'}:${e.index}`;
  return (
    <div className="ls-issues">
      <h4 className="ls-subhead">
        {title}
        {open.length ? <span className="badge warning">{open.length} open</span> : null}
      </h4>
      {open.length ? (
        <ul className="ls-issue-list">
          {open.map((e) => (
            <IssueItem key={key(e)} entry={e} onStatus={setStatus} />
          ))}
        </ul>
      ) : (
        <p className="small muted">No open issues.</p>
      )}
      {closed.length ? (
        <details className="ls-closed-issues">
          <summary>{closed.length} resolved or dismissed</summary>
          <ul className="ls-issue-list">
            {closed.map((e) => (
              <IssueItem key={key(e)} entry={e} onStatus={setStatus} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
