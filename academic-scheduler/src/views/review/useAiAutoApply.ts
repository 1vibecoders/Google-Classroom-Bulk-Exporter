// Loads the AI analysis status once, and applies the proposals that are safe
// to apply without asking (src/lib/ai/proposals.ts) when the person allows
// it: one undoable change with a notice; undo also rejects them, so they do
// not come back.
import { useEffect, useRef } from 'react';
import { automatic, applyProposal, reviewItems } from '../../lib/ai/proposals';
import { recordDecision } from '../../lib/ai/api';
import { nowLocal } from '../../lib/time';
import { forgetProposals, getAutoApply, refreshAiStatus, useAiStatus } from '../../state/aiStore';
import { useStore } from '../../state/store';
import { newSnapshotId } from '../import/logic';

export function useAiAutoApply(): void {
  const { state, dispatch, notify } = useStore();
  const status = useAiStatus();
  const busy = useRef(false);

  useEffect(() => {
    void refreshAiStatus();
  }, []);

  useEffect(() => {
    if (busy.current || !status?.proposals.length || !getAutoApply()) return;
    let work = state.doc;
    const applied: string[] = [];
    for (const item of automatic(reviewItems(state.doc, status.proposals))) {
      const result = applyProposal(work, item, false);
      if ('doc' in result) {
        work = result.doc;
        applied.push(item.proposal.key);
      }
    }
    if (!applied.length) return;
    busy.current = true;
    const snapshotId = newSnapshotId();
    dispatch({ type: 'replaceDocument', doc: work, label: 'Changes read from Classroom announcements', now: nowLocal(), snapshotId });
    forgetProposals(applied);
    void Promise.all(applied.map((key) => recordDecision(key, 'applied'))).finally(() => {
      busy.current = false;
    });
    notify(`Applied ${applied.length === 1 ? '1 change' : `${applied.length} changes`} read from Classroom announcements and instructions.`, {
      tone: 'success',
      action: {
        label: 'Undo',
        run: () => {
          dispatch({ type: 'undo', snapshotId });
          for (const key of applied) void recordDecision(key, 'rejected');
        },
      },
    });
  }, [status, state.doc, dispatch, notify]);
}
