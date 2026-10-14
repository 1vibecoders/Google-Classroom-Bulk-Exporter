// What the AI analysis (server/analysis.ts, SPEC.md § 16) proposes, as the
// website receives it. Every proposal cites the source it came from with a
// verbatim excerpt, says whether the value was stated or inferred, and has a
// confidence per field (§ 16.2). The website decides what to apply
// (src/lib/ai/proposals.ts); nothing here is trusted as a fact on its own.
import type { AssignmentType, Confidence, DateOrDateTimeStr, Id } from './types';

/** estimate: a time the text states; workload: the AI's own estimate (SPEC.md § 24.1), `excerpt` is its short basis. */
export type ProposalKind = 'due_change' | 'new_assessment' | 'estimate' | 'workload';

export interface AiProposal {
  /** Stable for the same evidence and value, so a decision is not asked again (§ 16.4). */
  key: string;
  kind: ProposalKind;
  /** Schedule ID of the class (`gc-class-…`). */
  classId: Id;
  /** The Classroom item (or attached Drive document) the evidence comes from. */
  source: { kind: 'announcement' | 'coursework' | 'document'; id: string; url?: string; postedAt?: DateOrDateTimeStr };
  /** Verbatim quote from the source (checked on the server). */
  excerpt: string;
  /** due_change and estimate: the assignment it is about. */
  assignmentId?: Id;
  /** new_assessment: what the source announces. */
  title?: string;
  type?: AssignmentType;
  /** due_change / new_assessment: the date; estimate: minutes. */
  value: DateOrDateTimeStr | number;
  /** Stated in the source (true) or inferred, e.g. from "next Friday" (false). */
  explicit: boolean;
  confidence: { identity: Confidence; value: Confidence };
  /** The model's short reason when it is unsure. */
  note?: string;
}

export interface AnalysisStatus {
  /** AI analysis is set up on this server. */
  configured: boolean;
  model?: string;
  proposals: AiProposal[];
  /** Sources waiting for analysis (new or changed since the last analysis). */
  pending: number;
  budget: { limit: number; used: number };
  /** Runs the person started that used the AI, in the last 24 hours; `nextAt` when none is left. */
  runs?: { limit: number; used: number; nextAt?: string };
  /** The free first run after setup has not been used yet. */
  setupAvailable?: boolean;
  lastRun?: { at: string; analyzed: number; reused: number; failed: number; trigger: 'user' | 'background' | 'setup'; error?: string };
}
