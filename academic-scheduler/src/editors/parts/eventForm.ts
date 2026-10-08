// Event (§ 10) and availability (§ 11) forms, with the weekly recurrence
// rule they share: conversion from/to the stored items and validation
// (§ 13.1 rule 5, § 13.3 rule 20).
import type { AvailabilityWindow, DateStr, EventCategory, Recurrence, ScheduleDocument, ScheduleEvent, Weekday } from '../../model/types';
import { WEEKDAYS } from '../../model/constants';
import { isValidDate, weekdayOf } from '../../lib/time';
import { neverOccurs } from '../../lib/recurrence';
import { ProblemList, checkInteger, checkText, checkTimeRange, compact, keepDefault, optionalText, type Problem } from './common';

export type RepeatMode = 'once' | 'weekly';

export interface RecurrenceForm {
  daysOfWeek: Weekday[];
  interval: number | '';
  startDate: string;
  endDate: string;
  exceptDates: string[];
}

export interface EventForm {
  title: string;
  category: EventCategory;
  classId: string;
  assignmentId: string;
  repeat: RepeatMode;
  date: string;
  /** Last day of a multi-day all-day one-time event ('' = one day). */
  endDate: string;
  recurrence: RecurrenceForm;
  allDay: boolean;
  startTime: string;
  /** HH:MM, or '24:00' for midnight at the end of the day. */
  endTime: string;
  busy: boolean;
  location: string;
  notes: string;
}

export interface AvailabilityForm {
  label: string;
  repeat: RepeatMode;
  date: string;
  recurrence: RecurrenceForm;
  startTime: string;
  endTime: string;
}

/** School days, the default for school hours and study time. */
export const SCHOOL_DAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

/**
 * The form of a rule. Without a rule: weekly from `fallbackDate`, on
 * `defaultDays` (or the weekday of `fallbackDate`).
 */
export function recurrenceToForm(rule: Recurrence | undefined, fallbackDate: string, defaultDays?: Weekday[]): RecurrenceForm {
  if (!rule) {
    const day = isValidDate(fallbackDate) ? weekdayOf(fallbackDate) : 'mon';
    return { daysOfWeek: defaultDays ? [...defaultDays] : [day], interval: 1, startDate: fallbackDate, endDate: '', exceptDates: [] };
  }
  return {
    daysOfWeek: WEEKDAYS.filter((d) => (rule.daysOfWeek || []).includes(d)),
    interval: rule.interval ?? 1,
    startDate: rule.startDate ?? '',
    endDate: rule.endDate ?? '',
    exceptDates: [...(rule.exceptDates || [])],
  };
}

export function checkRecurrence(problems: ProblemList, form: RecurrenceForm): void {
  if (form.daysOfWeek.length === 0) problems.add('recurrence.daysOfWeek', 'Choose at least one day of the week.', { required: true });
  checkInteger(problems, 'recurrence.interval', form.interval, { label: 'Repeat interval', min: 1, max: 52, required: true });
  if (!form.startDate) problems.add('recurrence.startDate', 'Start date is required.', { required: true });
  else if (!isValidDate(form.startDate)) problems.add('recurrence.startDate', 'Start date is not a valid date.');
  if (form.endDate) {
    if (!isValidDate(form.endDate)) problems.add('recurrence.endDate', 'End date is not a valid date.');
    else if (isValidDate(form.startDate) && form.endDate < form.startDate) problems.add('recurrence.endDate', 'The end date cannot be before the start date.');
  }
  if (form.exceptDates.some((d) => !isValidDate(d))) problems.add('recurrence.exceptDates', 'An exception date is not a valid date.');
}

/** The recurrence to store, keeping `x-…` properties of the original rule. */
export function formToRecurrence(form: RecurrenceForm, base: Recurrence | undefined): Recurrence {
  const exceptDates = [...new Set(form.exceptDates)].sort();
  return compact<Recurrence>({
    ...(base || {}),
    frequency: 'weekly',
    daysOfWeek: WEEKDAYS.filter((d) => form.daysOfWeek.includes(d)),
    interval: keepDefault(base?.interval, form.interval === '' ? 1 : form.interval, 1),
    startDate: form.startDate,
    endDate: form.endDate || undefined,
    exceptDates: exceptDates.length ? exceptDates : undefined,
  });
}

/** A rule (from the form) that would never produce a day, for a warning (§ 13.4). */
export function recurrenceNeverOccurs(form: RecurrenceForm): boolean {
  if (!form.daysOfWeek.length || !isValidDate(form.startDate)) return false;
  if (form.endDate && (!isValidDate(form.endDate) || form.endDate < form.startDate)) return false;
  return neverOccurs(formToRecurrence(form, undefined));
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export function eventToForm(item: Partial<ScheduleEvent> | undefined, today: DateStr): EventForm {
  const date = item?.date ?? item?.recurrence?.startDate ?? today;
  // New school hours (no date or rule given) repeat on school days.
  const schoolHours = !item?.date && !item?.recurrence && item?.category === 'school';
  return {
    title: item?.title ?? (schoolHours ? 'School' : ''),
    category: item?.category ?? 'other',
    classId: item?.classId ?? '',
    assignmentId: item?.assignmentId ?? '',
    repeat: item?.recurrence || schoolHours ? 'weekly' : 'once',
    date: item?.date ?? today,
    endDate: item?.endDate ?? '',
    recurrence: recurrenceToForm(item?.recurrence, date, schoolHours ? SCHOOL_DAYS : undefined),
    allDay: item?.allDay ?? false,
    startTime: item?.startTime ?? '',
    endTime: item?.endTime ?? '',
    busy: item?.busy ?? true,
    location: item?.location ?? '',
    notes: item?.notes ?? '',
  };
}

export function validateEventForm(form: EventForm, doc: ScheduleDocument): Problem[] {
  const problems = new ProblemList();
  checkText(problems, 'title', form.title, { label: 'Title', max: 200, required: true });
  checkText(problems, 'location', form.location, { label: 'Location', max: 200 });
  checkText(problems, 'notes', form.notes, { label: 'Notes', max: 10000 });
  if (form.classId && !doc.classes.some((c) => c.id === form.classId)) problems.add('classId', 'This class no longer exists. Choose another class.');
  if (form.assignmentId && !doc.assignments.some((a) => a.id === form.assignmentId)) {
    problems.add('assignmentId', 'This assessment no longer exists. Choose another one.');
  }
  if (form.repeat === 'once') {
    if (!form.date) problems.add('date', 'Date is required.', { required: true });
    else if (!isValidDate(form.date)) problems.add('date', 'Date is not a valid date.');
    if (form.allDay && form.endDate) {
      if (!isValidDate(form.endDate)) problems.add('endDate', 'End date is not a valid date.');
      else if (isValidDate(form.date) && form.endDate < form.date) problems.add('endDate', 'The last day cannot be before the first day.');
    }
  } else {
    checkRecurrence(problems, form.recurrence);
  }
  if (!form.allDay) checkTimeRange(problems, { start: 'startTime', end: 'endTime' }, form.startTime, form.endTime);
  return problems.items;
}

export function formToEvent(form: EventForm, base: ScheduleEvent): ScheduleEvent {
  const once = form.repeat === 'once';
  return compact<ScheduleEvent>({
    ...base,
    title: form.title.trim(),
    category: keepDefault(base.category, form.category, 'other'),
    classId: form.classId || undefined,
    assignmentId: form.assignmentId || undefined,
    date: once ? form.date : undefined,
    endDate: once && form.allDay && form.endDate && form.endDate !== form.date ? form.endDate : undefined,
    recurrence: once ? undefined : formToRecurrence(form.recurrence, base.recurrence),
    allDay: form.allDay ? true : keepDefault(base.allDay, false, false),
    startTime: form.allDay ? undefined : form.startTime,
    endTime: form.allDay ? undefined : form.endTime,
    busy: keepDefault(base.busy, form.busy, true),
    location: optionalText(form.location),
    notes: optionalText(form.notes),
  });
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export function availabilityToForm(item: Partial<AvailabilityWindow> | undefined, today: DateStr): AvailabilityForm {
  const date = item?.date ?? item?.recurrence?.startDate ?? today;
  return {
    label: item?.label ?? '',
    repeat: item?.date && !item.recurrence ? 'once' : 'weekly',
    date: item?.date ?? today,
    // New weekly study time starts out on school days.
    recurrence: recurrenceToForm(item?.recurrence, date, item?.date ? undefined : SCHOOL_DAYS),
    startTime: item?.startTime ?? '',
    endTime: item?.endTime ?? '',
  };
}

export function validateAvailabilityForm(form: AvailabilityForm): Problem[] {
  const problems = new ProblemList();
  checkText(problems, 'label', form.label, { label: 'Label', max: 200 });
  if (form.repeat === 'once') {
    if (!form.date) problems.add('date', 'Date is required.', { required: true });
    else if (!isValidDate(form.date)) problems.add('date', 'Date is not a valid date.');
  } else {
    checkRecurrence(problems, form.recurrence);
  }
  checkTimeRange(problems, { start: 'startTime', end: 'endTime' }, form.startTime, form.endTime);
  return problems.items;
}

export function formToAvailability(form: AvailabilityForm, base: AvailabilityWindow): AvailabilityWindow {
  const once = form.repeat === 'once';
  return compact<AvailabilityWindow>({
    ...base,
    label: optionalText(form.label),
    date: once ? form.date : undefined,
    recurrence: once ? undefined : formToRecurrence(form.recurrence, base.recurrence),
    startTime: form.startTime,
    endTime: form.endTime,
  });
}
