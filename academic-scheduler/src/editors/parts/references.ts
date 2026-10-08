// References (§ 8.2) as editable rows, shared by the class and assignment
// editors. A row keeps the original object so fields the form does not show
// (`path`, `x-…` properties) survive an edit.
import type { Reference, ReferenceKind } from '../../model/types';
import { ProblemList, checkText, compact, keepDefault, rowKey, urlProblem } from './common';

export interface ReferenceRow {
  key: string;
  /** The stored reference this row edits (absent for a new row). */
  base?: Reference;
  title: string;
  url: string;
  kind: ReferenceKind;
  required: boolean;
}

export function referenceRows(references: Reference[] | undefined): ReferenceRow[] {
  return (references || []).map((ref) => ({
    key: rowKey('ref'),
    base: ref,
    title: ref.title ?? '',
    url: ref.url ?? '',
    kind: ref.kind ?? 'attachment',
    required: ref.required ?? false,
  }));
}

export function newReferenceRow(): ReferenceRow {
  return { key: rowKey('ref'), title: '', url: '', kind: 'link', required: false };
}

export function checkReferences(problems: ProblemList, rows: ReferenceRow[], options: { max?: number } = {}): void {
  if (options.max !== undefined && rows.length > options.max) {
    problems.add('references', `At most ${options.max} references are allowed (now ${rows.length}).`);
  }
  rows.forEach((row, index) => {
    const context = `Reference ${index + 1}`;
    checkText(problems, `references.${row.key}.title`, row.title, { label: 'Title', max: 300, required: true, context });
    const problem = urlProblem(row.url);
    if (problem) problems.add(`references.${row.key}.url`, problem, { context });
  });
}

export function rowsToReferences(rows: ReferenceRow[]): Reference[] | undefined {
  if (!rows.length) return undefined;
  return rows.map((row) => {
    const base = row.base;
    const url = row.url.trim();
    return compact<Reference>({
      ...(base || {}),
      title: row.title.trim(),
      url: url || undefined,
      kind: keepDefault(base?.kind, row.kind, 'attachment'),
      required: keepDefault(base?.required, row.required, false),
    });
  });
}
