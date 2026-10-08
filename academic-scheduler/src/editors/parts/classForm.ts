// Class editor form (§ 7): conversion from/to SchoolClass and validation.
import type { SchoolClass } from '../../model/types';
import { ProblemList, checkText, compact, keepDefault, optionalText, type Problem } from './common';
import { checkReferences, referenceRows, rowsToReferences, type ReferenceRow } from './references';

export interface ClassForm {
  name: string;
  teacher: string;
  section: string;
  room: string;
  /** '' = automatic (the website assigns a palette color). */
  color: string;
  description: string;
  archived: boolean;
  /** One topic per line. */
  topicsText: string;
  references: ReferenceRow[];
}

const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

export function topicsToText(topics: string[] | undefined): string {
  return (topics || []).join('\n');
}

export function textToTopics(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function classToForm(item: Partial<SchoolClass> | undefined): ClassForm {
  return {
    name: item?.name ?? '',
    teacher: item?.teacher ?? '',
    section: item?.section ?? '',
    room: item?.room ?? '',
    color: item?.color ?? '',
    description: item?.description ?? '',
    archived: item?.archived ?? false,
    topicsText: topicsToText(item?.topics),
    references: referenceRows(item?.references),
  };
}

export function validateClassForm(form: ClassForm): Problem[] {
  const problems = new ProblemList();
  checkText(problems, 'name', form.name, { label: 'Name', max: 200, required: true });
  checkText(problems, 'teacher', form.teacher, { label: 'Teacher', max: 200 });
  checkText(problems, 'section', form.section, { label: 'Section', max: 200 });
  checkText(problems, 'room', form.room, { label: 'Room', max: 100 });
  checkText(problems, 'description', form.description, { label: 'Description', max: 5000 });
  if (form.color && !COLOR_RE.test(form.color)) problems.add('color', 'Choose a color like #2563EB.');
  const topics = textToTopics(form.topicsText);
  if (topics.length > 200) problems.add('topics', `At most 200 topics are allowed (now ${topics.length}).`);
  const long = topics.findIndex((t) => [...t].length > 200);
  if (long !== -1) problems.add('topics', `Topic ${long + 1} is too long (at most 200 characters).`);
  checkReferences(problems, form.references, { max: 200 });
  return problems.items;
}

/**
 * The class to store: `base` (the stored class, or `{ id }` for a new one)
 * with the form's fields applied. Fields the form does not show (source,
 * issues, `x-…`, …) are kept from `base`.
 */
export function formToClass(form: ClassForm, base: SchoolClass, initial: ClassForm): SchoolClass {
  // Keep the stored topics untouched when the text was not edited (the
  // textarea cannot represent blank topics exactly).
  const topics = form.topicsText === initial.topicsText ? base.topics : textToTopics(form.topicsText);
  return compact<SchoolClass>({
    ...base,
    name: form.name.trim(),
    teacher: optionalText(form.teacher),
    section: optionalText(form.section),
    room: optionalText(form.room),
    color: form.color ? form.color.toUpperCase() === base.color?.toUpperCase() ? base.color : form.color.toUpperCase() : undefined,
    description: optionalText(form.description),
    archived: keepDefault(base.archived, form.archived, false),
    topics: topics && topics.length ? topics : undefined,
    references: rowsToReferences(form.references),
  });
}
