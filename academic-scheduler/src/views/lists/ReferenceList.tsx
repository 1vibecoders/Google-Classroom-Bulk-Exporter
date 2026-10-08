// Attachments, links and materials (§ 8.2). Only http(s) and mailto URLs
// become links; anything else (javascript:, data:, file:, relative paths)
// is shown as plain text so that an imported file cannot inject a link.
import type { Reference, ReferenceKind } from '../../model/types';
import { Icon } from '../../ui/Icon';
import { safeHref } from './format';

const KIND_LABELS: Record<ReferenceKind, string> = {
  attachment: 'Attachment',
  link: 'Link',
  reading: 'Reading',
  rubric: 'Rubric',
  template: 'Template',
  other: 'Other',
};

export function ReferenceList({ references, empty }: { references: Reference[] | undefined; empty?: string }) {
  if (!references || references.length === 0) return empty ? <p className="small muted">{empty}</p> : null;
  return (
    <ul className="ls-refs">
      {references.map((ref, i) => {
        const href = safeHref(ref.url);
        return (
          <li key={i}>
            <Icon name={href ? 'link' : 'file'} size={14} />
            <div className="ls-ref-body">
              <div className="row ls-ref-title">
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {ref.title}
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <span>{ref.title}</span>
                )}
                <span className="badge">{KIND_LABELS[ref.kind ?? 'attachment'] ?? 'Attachment'}</span>
                {ref.required ? <span className="badge accent">Required</span> : null}
              </div>
              {ref.url && !href ? (
                <div className="small muted">
                  Link not opened for safety: <span className="mono">{ref.url}</span>
                </div>
              ) : null}
              {ref.path ? <div className="mono small muted ls-path">{ref.path}</div> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
