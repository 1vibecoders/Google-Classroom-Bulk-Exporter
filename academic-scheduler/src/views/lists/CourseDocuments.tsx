// A class's course documents: title (linked to Drive), what was read, and the
// text on request.
import { useState } from 'react';
import { DOCUMENT_STATUS_TEXT, type CourseDocument } from '../../model/courseDocument';
import { fetchDocumentText } from '../../lib/documents/api';
import { safeHref } from './format';

function DocumentItem({ doc }: { doc: CourseDocument }) {
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const href = safeHref(doc.url);
  const show = async () => {
    setState('loading');
    const value = await fetchDocumentText(doc.id);
    setState(value === null ? 'failed' : 'idle');
    setText(value);
  };
  return (
    <li className="stack">
      <div>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {doc.title}
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        ) : (
          <span>{doc.title}</span>
        )}
        <div className="small muted">
          {doc.status === 'ok' ? `${doc.chars.toLocaleString('en-US')} characters of text read` : DOCUMENT_STATUS_TEXT[doc.status]}
          {doc.via === 'extension' ? ' · from the browser extension' : ''}
        </div>
      </div>
      {doc.status === 'ok' ? (
        text === null ? (
          <div>
            <button type="button" className="btn small" onClick={() => void show()} disabled={state === 'loading'}>
              {state === 'loading' ? 'Loading…' : 'Show text'}
            </button>
            {state === 'failed' ? (
              <span className="small" role="alert">
                {' '}
                The text could not be loaded.
              </span>
            ) : null}
          </div>
        ) : (
          <p className="ls-text small ls-document-text">{text}</p>
        )
      ) : null}
    </li>
  );
}

export function CourseDocuments({ documents }: { documents: CourseDocument[] }) {
  if (!documents.length) return null;
  return (
    <details>
      <summary className="ls-subhead">Course documents ({documents.length})</summary>
      <ul className="stack ls-announcements">
        {documents.map((d) => (
          <DocumentItem key={d.id} doc={d} />
        ))}
      </ul>
    </details>
  );
}
