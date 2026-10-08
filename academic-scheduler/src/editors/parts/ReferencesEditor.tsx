// Editable list of references (§ 8.2): title, link, kind, required.
import { useState } from 'react';
import { REFERENCE_KINDS } from '../../model/constants';
import type { ReferenceKind } from '../../model/types';
import { Icon } from '../../ui/Icon';
import { Checkbox, SelectField, TextField } from '../../ui/fields';
import { newReferenceRow, type ReferenceRow } from './references';
import { safeHref } from './labels';
import { urlProblem } from './common';

const KIND_LABELS: Record<ReferenceKind, string> = {
  attachment: 'Attachment',
  link: 'Link',
  reading: 'Reading',
  rubric: 'Rubric',
  template: 'Template',
  other: 'Other',
};

export function ReferencesEditor({
  rows,
  onChange,
  error,
  emptyText,
}: {
  rows: ReferenceRow[];
  onChange: (rows: ReferenceRow[]) => void;
  error: (key: string) => string | null;
  emptyText: string;
}) {
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const update = (key: string, patch: Partial<ReferenceRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const listError = error('references');
  return (
    <div className="ed-refs">
      {rows.length === 0 ? <p className="muted small">{emptyText}</p> : null}
      {rows.map((row, index) => {
        const href = !urlProblem(row.url) ? safeHref(row.url) : null;
        const name = row.title.trim() || `reference ${index + 1}`;
        return (
          <div key={row.key} className="ed-ref" role="group" aria-label={`Reference ${index + 1}`}>
            <div className="ed-ref-grid">
              <TextField label="Title" required autoFocus={row.key === focusKey} value={row.title} onChange={(v) => update(row.key, { title: v })} error={error(`references.${row.key}.title`)} />
              <TextField
                label="Link"
                type="url"
                placeholder="https://…"
                value={row.url}
                onChange={(v) => update(row.key, { url: v })}
                error={error(`references.${row.key}.url`)}
                hint={
                  href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      Open link<span className="visually-hidden"> (opens in a new tab)</span>
                    </a>
                  ) : undefined
                }
              />
              <SelectField<ReferenceKind>
                label="Kind"
                value={row.kind}
                options={REFERENCE_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
                onChange={(v) => update(row.key, { kind: (v || 'attachment') as ReferenceKind })}
              />
              <div className="ed-ref-side">
                <Checkbox label="Required" checked={row.required} onChange={(v) => update(row.key, { required: v })} />
                <button type="button" className="btn ghost icon small" aria-label={`Remove ${name}`} onClick={() => onChange(rows.filter((r) => r.key !== row.key))}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
            {row.base?.path ? (
              <div className="mono small muted ed-path" title="Path inside the export (kept as is)">
                <Icon name="file" size={12} /> {row.base.path}
              </div>
            ) : null}
          </div>
        );
      })}
      {listError ? (
        <span className="error small" role="alert">
          {listError}
        </span>
      ) : null}
      <div>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            const row = newReferenceRow();
            setFocusKey(row.key);
            onChange([...rows, row]);
          }}
        >
          <Icon name="plus" size={14} />
          Add reference
        </button>
      </div>
    </div>
  );
}
