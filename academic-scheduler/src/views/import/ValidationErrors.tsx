// A list of validation problems (or warnings), grouped by the item they are
// in, each with its path in the file. Long lists show the first 50 and a
// count of the rest; "Copy the list" copies every problem as plain text.
import { useState } from 'react';
import type { ValidationIssue } from '../../lib/validate';
import { Icon } from '../../ui/Icon';
import { errorsAsText, groupErrors } from './logic';

export const ERROR_LIMIT = 50;

export function ValidationErrors({
  errors,
  raw,
  showPaths = true,
  tone = 'error',
}: {
  errors: ValidationIssue[];
  raw?: unknown;
  showPaths?: boolean;
  tone?: 'error' | 'warning';
}) {
  const grouped = groupErrors(errors, raw, ERROR_LIMIT);
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  const canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard?.writeText;
  const hidden = grouped.total - grouped.shown;
  const noun = tone === 'error' ? 'problem' : 'warning';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(errorsAsText(errors));
      setCopied('yes');
    } catch {
      setCopied('no');
    }
  };

  // A single problem without a location (e.g. a JSON syntax error) needs no grouping.
  if (errors.length === 1 && (!showPaths || !errors[0].path)) {
    return <p style={{ margin: 0 }}>{errors[0].message}</p>;
  }

  return (
    <div className={`imp-errors ${tone}`}>
      {grouped.groups.map((group) => (
        <div key={group.key || '(root)'} className="imp-error-group">
          <h3 className="imp-error-group-title">
            {group.label}
            {group.key && group.key !== group.label ? <span className="mono small muted"> {group.key}</span> : null}
          </h3>
          <ul className="imp-error-list">
            {group.issues.map((issue, i) => (
              <li key={i}>
                <Icon name={tone === 'error' ? 'x' : 'warning'} size={12} />
                <span>
                  {showPaths && issue.path ? (
                    <>
                      <code className="imp-path">{issue.path}</code>{' '}
                    </>
                  ) : null}
                  {issue.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {hidden > 0 ? (
        <p className="small" style={{ margin: 0 }}>
          … and {hidden} more {hidden === 1 ? noun : `${noun}s`} not shown ({grouped.total} in all).
        </p>
      ) : null}
      {canCopy ? (
        <div className="row">
          <button type="button" className="btn small" onClick={() => void copy()}>
            <Icon name="copy" size={14} /> Copy the list{grouped.total > 1 ? ` (${grouped.total})` : ''}
          </button>
          <span className="small muted" role="status">
            {copied === 'yes' ? 'Copied.' : copied === 'no' ? 'Could not copy; select the text instead.' : ''}
          </span>
        </div>
      ) : null}
    </div>
  );
}
