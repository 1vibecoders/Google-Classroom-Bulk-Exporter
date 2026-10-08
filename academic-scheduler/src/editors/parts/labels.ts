// Display helpers for the editors (no React, no device clock).

/** Link schemes that may be clickable; everything else is shown as text. */
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/**
 * The URL to use as an `href`, or null when it must not be clickable: only
 * absolute http:, https: and mailto: URLs without spaces or control
 * characters (never javascript:, data:, file: or relative URLs).
 */
export function safeHref(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(trimmed)) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  const protocol = parsed.protocol.toLowerCase();
  if (!SAFE_SCHEMES.has(protocol)) return null;
  if (protocol !== 'mailto:' && !parsed.hostname) return null;
  return parsed.href;
}

/** Plain names of item fields, for "Your edits are kept: due date and priority". */
export const FIELD_LABELS: Record<string, string> = {
  name: 'name',
  title: 'title',
  teacher: 'teacher',
  section: 'section',
  room: 'room',
  color: 'color',
  description: 'description',
  archived: 'archived',
  topics: 'topics',
  references: 'references',
  classId: 'class',
  type: 'type',
  topic: 'topic',
  due: 'due date',
  assessmentDate: 'assessment date',
  recommendedCompletionDate: 'target date',
  recommendedStartDate: 'start date',
  estimatedMinutes: 'estimate',
  estimateRange: 'estimate range',
  estimateConfidence: 'estimate confidence',
  estimateBasis: 'estimate basis',
  priority: 'priority',
  points: 'points',
  required: 'required',
  sourceState: 'source state',
  tasks: 'subtask order',
  dependsOn: 'prerequisites',
  category: 'category',
  assignmentId: 'assignment',
  date: 'date',
  endDate: 'end date',
  recurrence: 'repeat rule',
  allDay: 'all day',
  startTime: 'start time',
  endTime: 'end time',
  busy: 'busy',
  location: 'location',
  label: 'label',
  start: 'start',
  end: 'end',
  taskId: 'subtask',
  kind: 'kind',
};

export function describeFields(fields: string[]): string {
  const names = fields.map((f) => FIELD_LABELS[f] ?? f);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "1 block" / "3 blocks". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
