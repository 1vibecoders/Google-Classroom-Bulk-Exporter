// Builds the first schedule (lib/ai/firstSchedule.ts) and commits it as one
// undoable change with a notice: at the end of setup, and from Settings while
// the free AI run is still available (for example after it failed).
import { useState } from 'react';
import { firstSchedule } from '../lib/ai/firstSchedule';
import { recordDecision } from '../lib/ai/api';
import { nowLocal } from '../lib/time';
import { setAiStatus } from '../state/aiStore';
import { useStore } from '../state/store';
import { newSnapshotId } from './import/logic';

/** `build` resolves to false when nothing was built (already building, or an unexpected failure, shown as a notice). */
export function useFirstSchedule(): { building: boolean; build: (useAi: boolean, lead: string) => Promise<boolean> } {
  const { state, dispatch, notify } = useStore();
  const [building, setBuilding] = useState(false);

  const build = async (useAi: boolean, lead: string): Promise<boolean> => {
    if (building) return false;
    setBuilding(true);
    const doc = state.doc;
    let built: Awaited<ReturnType<typeof firstSchedule>>;
    try {
      built = await firstSchedule(doc, useAi, Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch (error) {
      notify(`Your plan could not be built (${error instanceof Error ? error.message : String(error)}). Nothing was changed; try again.`, { tone: 'warning' });
      return false;
    } finally {
      setBuilding(false);
    }
    if (built.status) setAiStatus(built.status);
    const parts = [lead];
    if (built.events) parts.push(`Added ${built.events} ${built.events === 1 ? 'commitment' : 'commitments'} from your description to the calendar.`);
    if (built.questions) parts.push(`${built.questions === 1 ? 'One part' : `${built.questions} parts`} of your description need more detail; see the open questions.`);
    if (built.notPlanned) parts.push(`No work session could be planned: ${built.notPlanned}`);
    if (built.sessions) parts.push(`Planned ${built.sessions} work ${built.sessions === 1 ? 'session' : 'sessions'} in your free study time.`);
    if (built.estimated) parts.push(`The AI estimated the time for ${built.estimated} ${built.estimated === 1 ? 'assignment' : 'assignments'}; you can edit any estimate.`);
    if (built.review) {
      const dates = built.dueChanges ? `, including ${built.dueChanges === 1 ? 'a changed due date' : `${built.dueChanges} changed due dates`}` : '';
      parts.push(`${built.review === 1 ? 'One AI finding waits' : `${built.review} AI findings wait`} in Review${dates}: they would replace what Classroom says or are less certain, so you decide.`);
    }
    if (built.problem) parts.push(`AI could not be used: ${built.problem} You can try the free AI run again from Settings.`);
    const tone = built.problem ? 'warning' : 'success';
    if (built.doc === doc) {
      notify(parts.join(' '), { tone });
      return true;
    }
    const snapshotId = newSnapshotId();
    dispatch({ type: 'replaceDocument', doc: built.doc, label: 'Your first schedule', now: nowLocal(), snapshotId });
    for (const key of built.applied) void recordDecision(key, 'applied');
    notify(parts.join(' '), {
      tone,
      action: {
        label: 'Undo',
        run: () => {
          dispatch({ type: 'undo', snapshotId });
          for (const key of built.applied) void recordDecision(key, 'rejected');
        },
      },
    });
    return true;
  };

  return { building, build };
}
