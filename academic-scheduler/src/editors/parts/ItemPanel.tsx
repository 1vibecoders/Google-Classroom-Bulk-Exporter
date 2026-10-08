// "About this item" panel at the top of an editor: who made the item
// (§ 6.1 origin), where it came from (source, retrievedAt), the person's kept
// edits (§ 6.3 overrides) with "Allow /academic-schedule to update this
// again", pinning (§ 6.2 locked) and the item's issues with
// resolve/dismiss. These controls act immediately (they are not part of the
// form), and the editor saves on top of the latest stored item.
import { useState } from 'react';
import { ISSUE_KIND_LABELS, ISSUE_STATUS_LABELS, SOURCE_KIND_LABELS } from '../../model/constants';
import type { CollectionName, Issue, IssueStatus, ItemBase, Source, Task } from '../../model/types';
import { formatDateShort, isValidLocalDateTime } from '../../lib/time';
import { newId } from '../../lib/ids';
import { useStore } from '../../state/store';
import { Icon } from '../../ui/Icon';
import { describeFields, safeHref } from './labels';

export function originLabel(origin: ItemBase['origin']): string {
  switch (origin ?? 'generated') {
    case 'user':
      return 'Created by you';
    case 'planner':
      return 'Placed by the planner';
    default:
      return 'Imported from /academic-schedule';
  }
}

function sourceText(source: Source, currentYear: number): string {
  const parts: string[] = [SOURCE_KIND_LABELS[source.kind] ?? 'Source'];
  if (source.label) parts.push(source.label);
  else if (source.path) parts.push(source.path);
  if (source.retrievedAt && isValidLocalDateTime(source.retrievedAt)) {
    parts.push(`retrieved ${formatDateShort(source.retrievedAt.slice(0, 10), currentYear)}`);
  }
  return parts.join(' · ');
}

function SourceItem({ source, currentYear }: { source: Source; currentYear: number }) {
  const href = safeHref(source.url);
  return (
    <li>
      <span>{sourceText(source, currentYear)}</span>
      {href ? (
        <>
          {' · '}
          <a href={href} target="_blank" rel="noopener noreferrer">
            Open source
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </>
      ) : null}
    </li>
  );
}

type AnyItem = ItemBase & { tasks?: Task[]; title?: string; name?: string; label?: string };

export function ItemPanel({ collection, id, itemLabel }: { collection: CollectionName; id: string; itemLabel: string }) {
  const { state, dispatch, notify } = useStore();
  const doc = state.doc;
  const item = (doc[collection] as AnyItem[]).find((x) => x.id === id);
  const [showDetails, setShowDetails] = useState(false);
  if (!item) return null;

  const currentYear = new Date().getFullYear();
  const origin = item.origin ?? 'generated';
  const isUser = origin === 'user';
  const overrides = isUser ? [] : item.overrides || [];
  const taskOverrides = isUser ? [] : (item.tasks || []).filter((t) => (t.overrides || []).length > 0);
  const hasOverrides = overrides.length > 0 || taskOverrides.length > 0;
  const sources = [item.source, ...(item.sources || [])].filter((s): s is Source => !!s);
  const rootIssues = (doc.issues || []).map((issue, index) => ({ issue, index })).filter((x) => x.issue.itemId === id);
  const ownIssues = (item.issues || []).map((issue, index) => ({ issue, index }));

  const setLocked = (locked: boolean) => {
    dispatch({ type: 'setLocked', collection, id, locked });
    notify(locked ? `Pinned. /academic-schedule will not change, move or delete this ${itemLabel}.` : `Unpinned. /academic-schedule may update this ${itemLabel} again.`, { tone: 'success' });
  };
  const clearOverrides = () => {
    dispatch({ type: 'clearOverrides', collection, id });
    notify(`/academic-schedule may update this ${itemLabel} again. Your current values stay until it does.`, { tone: 'success' });
  };
  const setIssueStatus = (scope: 'item' | 'root', index: number, status: IssueStatus) => {
    dispatch({ type: 'setIssueStatus', scope: scope === 'root' ? null : { collection, id }, index, status, newIssueId: newId('iss') });
  };

  return (
    <div className="ed-panel">
      <div className="ed-panel-row">
        <span className={`badge ${isUser ? '' : 'accent'}`}>
          <Icon name={isUser ? 'edit' : origin === 'planner' ? 'wand' : 'download'} size={12} />
          {originLabel(origin)}
        </span>
        {item.locked ? (
          <span className="badge warning">
            <Icon name="lock" size={12} />
            Pinned
          </span>
        ) : null}
        <span className="ed-panel-spacer" />
        <button type="button" className="btn small" onClick={() => setLocked(!item.locked)}>
          <Icon name={item.locked ? 'unlock' : 'lock'} size={14} />
          {item.locked ? 'Unpin' : 'Pin'}
        </button>
        <button type="button" className="btn small ghost" aria-expanded={showDetails} onClick={() => setShowDetails((v) => !v)}>
          <Icon name="info" size={14} />
          Details
        </button>
      </div>

      <p className="ed-panel-text muted small">
        {item.locked
          ? `Pinned: /academic-schedule will not change, move or delete this ${itemLabel}.`
          : isUser
            ? `You created this ${itemLabel}; /academic-schedule only changes it when you ask it to.`
            : `/academic-schedule may update this ${itemLabel} when you import a newer schedule. Fields you edit here are kept.`}
      </p>

      {hasOverrides ? (
        <div className="ed-panel-overrides">
          <p className="small">
            <Icon name="edit" size={12} /> Your edits are kept when /academic-schedule updates the schedule:{' '}
            {overrides.length ? <strong>{describeFields(overrides)}</strong> : null}
            {overrides.length && taskOverrides.length ? ', and ' : null}
            {taskOverrides.length ? <strong>{taskOverrides.length === 1 ? `subtask “${taskOverrides[0].title}”` : `${taskOverrides.length} subtasks`}</strong> : null}.
          </p>
          <button type="button" className="btn small" onClick={clearOverrides}>
            <Icon name="undo" size={14} />
            Allow /academic-schedule to update this again
          </button>
        </div>
      ) : null}

      {showDetails ? (
        <div className="ed-panel-details small">
          {sources.length ? (
            <>
              <div className="muted">Source{sources.length > 1 ? 's' : ''}</div>
              <ul className="ed-source-list">
                {sources.map((s, i) => (
                  <SourceItem key={i} source={s} currentYear={currentYear} />
                ))}
              </ul>
            </>
          ) : (
            <div className="muted">No source recorded.</div>
          )}
          <div>
            <span className="muted">ID </span>
            <code className="mono">{item.id}</code>
          </div>
        </div>
      ) : null}

      {ownIssues.length || rootIssues.length ? (
        <ul className="ed-issues" aria-label="Issues">
          {ownIssues.map(({ issue, index }) => (
            <IssueRow key={`i${index}`} issue={issue} onStatus={(s) => setIssueStatus('item', index, s)} />
          ))}
          {rootIssues.map(({ issue, index }) => (
            <IssueRow key={`r${index}`} issue={issue} onStatus={(s) => setIssueStatus('root', index, s)} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function IssueRow({ issue, onStatus }: { issue: Issue; onStatus: (status: IssueStatus) => void }) {
  const status = issue.status ?? 'open';
  const open = status === 'open';
  return (
    <li className={`ed-issue ${open ? '' : 'closed'}`}>
      <Icon name={open ? 'warning' : 'check'} size={14} />
      <div className="ed-issue-text">
        <strong>{ISSUE_KIND_LABELS[issue.kind] ?? 'Note'}:</strong> {issue.message}
        {!open ? <span className="badge">{ISSUE_STATUS_LABELS[status]}</span> : null}
      </div>
      <div className="ed-issue-actions">
        {open ? (
          <>
            <button type="button" className="btn small" onClick={() => onStatus('resolved')}>
              Mark resolved
            </button>
            <button type="button" className="btn small ghost" onClick={() => onStatus('dismissed')}>
              Dismiss
            </button>
          </>
        ) : (
          <button type="button" className="btn small ghost" onClick={() => onStatus('open')}>
            Reopen
          </button>
        )}
      </div>
    </li>
  );
}

/** Read-only issues of a task (tasks have no issue actions in the store). */
export function TaskIssues({ issues }: { issues?: Issue[] }) {
  if (!issues || !issues.length) return null;
  return (
    <ul className="ed-issues compact" aria-label="Subtask issues">
      {issues.map((issue, i) => (
        <li key={i} className={`ed-issue ${(issue.status ?? 'open') === 'open' ? '' : 'closed'}`}>
          <Icon name="warning" size={14} />
          <div className="ed-issue-text">
            <strong>{ISSUE_KIND_LABELS[issue.kind] ?? 'Note'}:</strong> {issue.message}
          </div>
        </li>
      ))}
    </ul>
  );
}
