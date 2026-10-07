// Validation of schedule files against SCHEDULE_FORMAT.md (structure § 1–12
// and semantic rules § 13). Imported data is treated strictly as data: this
// module only inspects values; nothing is evaluated.
import type { DateStr, ScheduleDocument } from '../model/types';

export interface ValidationIssue {
  /** JSON-path-like location, e.g. `assignments[3].due` or `` for the root. */
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  /** The validated document (with `:SS` seconds normalized away) when ok. */
  doc?: ScheduleDocument;
  errors: ValidationIssue[];
  /** Accepted-but-suspicious things (§ 13 "Warnings"). */
  warnings: ValidationIssue[];
  /** The file's schemaVersion if it could be read. */
  schemaVersion?: string;
}

export interface ValidateOptions {
  /** Used for the "more than 5 years away" warning. Defaults to the device date. */
  today?: DateStr;
}

/**
 * Validate a parsed JSON value. Reports every problem (not just the first),
 * each with a path. Rejects unsupported schemaVersion values with a clear
 * message (§ 2) before doing anything else.
 */
export function validateDocument(input: unknown, options: ValidateOptions = {}): ValidationResult {
  void input;
  void options;
  throw new Error('validateDocument: not implemented');
}

/**
 * Parse text (file contents or pasted JSON) and validate it. Enforces the
 * 10 MB limit and reports JSON syntax errors with line/column when possible.
 */
export function parseScheduleText(text: string, options: ValidateOptions = {}): ValidationResult {
  void text;
  void options;
  throw new Error('parseScheduleText: not implemented');
}
