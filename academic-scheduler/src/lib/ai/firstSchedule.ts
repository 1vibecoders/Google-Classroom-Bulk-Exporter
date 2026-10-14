// The first schedule after setup (SPEC.md § 5, § 23): when AI is set up, the
// free setup run reads everything brought in (announcements, instructions,
// documents) and estimates the work; the safe findings are applied the same way
// as at any other time (proposals.ts: only gaps are filled, nothing the person
// set is replaced); then the fixed-rule planner puts the unscheduled work into
// free study time. The AI never places sessions itself.
import type { AnalysisStatus } from '../../model/aiProposal';
import type { ScheduleDocument } from '../../model/types';
import { DEFAULT_HORIZON_DAYS, planUnscheduledWork } from '../planner';
import { nowLocal, todayLocal } from '../time';
import { runAnalysis } from './api';
import { applyCommitments } from './commitments';
import { uploadSources } from './sources';
import { applyProposal, automatic, reviewItems } from './proposals';

export interface FirstSchedule {
  doc: ScheduleDocument;
  /** Proposals applied (to record as decided). */
  applied: string[];
  estimated: number;
  sessions: number;
  /** Events read from the person's description of their commitments, and questions about it. */
  events: number;
  questions: number;
  /** Findings that wait in Review (never applied on their own, § 16.4), and how many of them change a due date. */
  review: number;
  dueChanges: number;
  /** The analysis status to show next, without the applied proposals; null when AI was not used. */
  status: AnalysisStatus | null;
  /** Why AI could not be used, when it was set up but failed. */
  problem?: string;
}

export async function firstSchedule(doc: ScheduleDocument, useAi: boolean, timezone: string): Promise<FirstSchedule> {
  let work = doc;
  const applied: string[] = [];
  let estimated = 0;
  let status: AnalysisStatus | null = null;
  let problem: string | undefined;
  let events = 0;
  let questions = 0;
  let review = 0;
  let dueChanges = 0;
  if (useAi) {
    const result = await runAnalysis(timezone, true, doc.settings?.commitmentsDescription, uploadSources(doc));
    if ('error' in result) problem = result.error;
    else {
      if (result.message) problem = result.message;
      // Commitments first, so the planner keeps them free.
      if (result.commitments) ({ doc: work, added: events, questions } = applyCommitments(work, result.commitments, todayLocal()));
      for (const item of automatic(reviewItems(work, result.proposals))) {
        const next = applyProposal(work, item, false);
        if (!('doc' in next)) continue;
        work = next.doc;
        applied.push(item.proposal.key);
        if (item.proposal.kind === 'workload') estimated++;
      }
      status = { ...result, proposals: result.proposals.filter((p) => !applied.includes(p.key)) };
      const waiting = reviewItems(work, status.proposals);
      review = waiting.length;
      dueChanges = waiting.filter((i) => i.field === 'due').length;
    }
  }
  const plan = planUnscheduledWork(work, { from: nowLocal(), horizonDays: DEFAULT_HORIZON_DAYS });
  if (plan.blocks.length) work = { ...work, scheduleBlocks: [...work.scheduleBlocks, ...plan.blocks] };
  return { doc: work, applied, estimated, sessions: plan.blocks.length, events, questions, review, dueChanges, status, ...(problem ? { problem } : {}) };
}
