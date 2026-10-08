// Everything the day and week views do to the schedule, in one place:
// open the block actions dialog or an editor, create/move/mark/delete blocks,
// resolve or dismiss issues. Changes go through the reducer only.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BlockView, DayIssue, EventOccurrence } from '../../lib/calendar';
import type { BlockStatus, DateStr, IssueStatus, ScheduleBlock } from '../../model/types';
import { useStore } from '../../state/store';
import { useEditors } from '../../editors/EditorHost';
import { useConfirm } from '../../ui/common';
import { newId } from '../../lib/ids';
import { formatDateWithWeekday, isValidLocalDateTime, nowLocal } from '../../lib/time';
import { BlockActionsDialog } from './BlockActionsDialog';
import { blockSpan, formatSpan, spanToLdt, type ItemRef, type Span } from './logic';

export interface TimelineActions {
  /** Open the quick actions (mark done, skip, move, edit, delete) of a block. */
  openBlock: (view: BlockView) => void;
  openBlockById: (id: string) => void;
  openEvent: (occurrence: EventOccurrence) => void;
  openAssignment: (id: string) => void;
  openItem: (item: ItemRef) => void;
  /** Open the block editor for a new block at that time. */
  createBlock: (date: DateStr, span: Span) => void;
  moveBlock: (view: BlockView, date: DateStr, span: Span, via: 'pointer' | 'keyboard' | 'dialog') => void;
  setBlockStatus: (block: ScheduleBlock, status: BlockStatus, label: string) => void;
  deleteBlock: (block: ScheduleBlock, label: string) => Promise<boolean>;
  setIssueStatus: (issue: DayIssue, status: IssueStatus) => void;
  addStudyTime: () => void;
  /** The block actions dialog, to render once in the view. */
  dialog: ReactNode;
}

function isGeneratedLike(block: ScheduleBlock): boolean {
  return (block.origin ?? 'generated') !== 'user';
}

const STATUS_MESSAGES: Record<BlockStatus, (label: string) => string> = {
  done: (label) => `Marked “${label}” done.`,
  skipped: (label) => `Marked “${label}” as skipped.`,
  planned: (label) => `“${label}” is planned again.`,
};

export function useTimelineActions(): TimelineActions {
  const { state, dispatch, notify } = useStore();
  const editors = useEditors();
  const confirm = useConfirm();
  const [openBlockId, setOpenBlockId] = useState<string | null>(null);
  const doc = state.doc;

  const openBlock = useCallback((view: BlockView) => setOpenBlockId(view.block.id), []);
  const openBlockById = useCallback((id: string) => setOpenBlockId(id), []);
  const closeBlock = useCallback(() => setOpenBlockId(null), []);
  /** Close the actions dialog and put keyboard focus back on the block in the timeline. */
  const openRef = useRef<string | null>(null);
  useEffect(() => {
    openRef.current = openBlockId;
  }, [openBlockId]);
  const closeAndRefocus = useCallback(() => {
    const id = openRef.current;
    setOpenBlockId(null);
    if (!id) return;
    requestAnimationFrame(() => {
      const el = Array.from(document.querySelectorAll<HTMLElement>('.tl-block[data-block-id]')).find((b) => b.dataset.blockId === id);
      el?.querySelector<HTMLButtonElement>('.tl-block-main')?.focus();
    });
  }, []);
  const openEvent = useCallback((occurrence: EventOccurrence) => editors.open({ kind: 'event', id: occurrence.event.id }), [editors]);
  const openAssignment = useCallback((id: string) => editors.open({ kind: 'assignment', id }), [editors]);

  const openItem = useCallback(
    (item: ItemRef) => {
      switch (item.kind) {
        case 'class':
          editors.open({ kind: 'class', id: item.id });
          break;
        case 'assignment':
          editors.open({ kind: 'assignment', id: item.id });
          break;
        case 'task':
          editors.open({ kind: 'assignment', id: item.assignmentId });
          break;
        case 'event':
          editors.open({ kind: 'event', id: item.id });
          break;
        case 'availability':
          editors.open({ kind: 'availability', id: item.id });
          break;
        case 'block':
          setOpenBlockId(item.id);
          break;
      }
    },
    [editors],
  );

  const createBlock = useCallback(
    (date: DateStr, span: Span) => {
      const { start, end } = spanToLdt(date, span);
      editors.open({ kind: 'block', initial: { start, end } });
    },
    [editors],
  );

  const moveBlock = useCallback(
    (view: BlockView, date: DateStr, span: Span, via: 'pointer' | 'keyboard' | 'dialog') => {
      const block = view.block;
      const { start, end } = spanToLdt(date, span);
      const before = { start: block.start, end: block.end, locked: block.locked === true };
      dispatch({ type: 'moveBlock', id: block.id, start, end });
      if (via !== 'pointer') return;
      const pinned = isGeneratedLike(block) && !block.locked ? ' It is now pinned, so later imports keep your time.' : '';
      notify(`Moved “${view.label}” to ${formatDateWithWeekday(date)}, ${formatSpan(span.start, span.end)}.${pinned}`, {
        tone: 'success',
        action: {
          label: 'Undo',
          run: () => {
            dispatch({ type: 'moveBlock', id: block.id, start: before.start, end: before.end });
            dispatch({ type: 'setLocked', collection: 'scheduleBlocks', id: block.id, locked: before.locked });
          },
        },
      });
    },
    [dispatch, notify],
  );

  const setBlockStatus = useCallback(
    (block: ScheduleBlock, status: BlockStatus, label: string) => {
      const previous = block.status ?? 'planned';
      if (previous === status) return;
      dispatch({ type: 'setBlockStatus', id: block.id, status, now: nowLocal() });
      notify(STATUS_MESSAGES[status](label), {
        tone: 'success',
        action: { label: 'Undo', run: () => dispatch({ type: 'setBlockStatus', id: block.id, status: previous, now: nowLocal() }) },
      });
    },
    [dispatch, notify],
  );

  const deleteBlock = useCallback(
    async (block: ScheduleBlock, label: string) => {
      const where = blockSpan(block);
      const when = where ? `${formatDateWithWeekday(where.date)}, ${formatSpan(where.span.start, where.span.end)}` : isValidLocalDateTime(block.start) ? block.start : '';
      const generated = (block.origin ?? 'generated') === 'generated';
      const ok = await confirm({
        title: 'Delete this work block?',
        message: (
          <div className="stack" style={{ gap: 8 }}>
            <p style={{ margin: 0 }}>
              “{label}”{when ? ` (${when})` : ''} will be removed from your schedule. The assignment itself is kept.
            </p>
            {block.status === 'done' ? <p style={{ margin: 0 }}>This session is marked done; its minutes will no longer count as finished work.</p> : null}
            {generated ? <p style={{ margin: 0 }}>It was planned by /academic-schedule. A later import will not add it again.</p> : null}
          </div>
        ),
        confirmLabel: 'Delete block',
        danger: true,
      });
      if (!ok) return false;
      dispatch({ type: 'deleteBlocks', ids: [block.id], now: nowLocal() });
      setOpenBlockId((id) => (id === block.id ? null : id));
      notify(`Deleted “${label}”.`, { tone: 'success' });
      return true;
    },
    [confirm, dispatch, notify],
  );

  const setIssueStatus = useCallback(
    (dayIssue: DayIssue, status: IssueStatus) => {
      const previous = dayIssue.issue.status ?? 'open';
      if (previous === status) return;
      dispatch({ type: 'setIssueStatus', scope: dayIssue.scope, index: dayIssue.index, status, newIssueId: newId('iss') });
      const message = status === 'resolved' ? 'Issue marked resolved.' : status === 'dismissed' ? 'Issue dismissed.' : 'Issue reopened.';
      notify(message, {
        tone: 'success',
        action: { label: 'Undo', run: () => dispatch({ type: 'setIssueStatus', scope: dayIssue.scope, index: dayIssue.index, status: previous, newIssueId: newId('iss') }) },
      });
    },
    [dispatch, notify],
  );

  const addStudyTime = useCallback(() => editors.open({ kind: 'availability' }), [editors]);

  const dialog = openBlockId ? (
    <BlockActionsDialog
      key={openBlockId}
      doc={doc}
      blockId={openBlockId}
      onClose={closeAndRefocus}
      onMove={(view, date, span) => moveBlock(view, date, span, 'dialog')}
      onStatus={(block, status, label) => {
        setBlockStatus(block, status, label);
        closeAndRefocus();
      }}
      onLocked={(block, locked) => dispatch({ type: 'setLocked', collection: 'scheduleBlocks', id: block.id, locked })}
      onEdit={(block) => {
        closeBlock();
        editors.open({ kind: 'block', id: block.id });
      }}
      onOpenAssignment={(id) => {
        closeBlock();
        editors.open({ kind: 'assignment', id });
      }}
      onDelete={deleteBlock}
    />
  ) : null;

  return useMemo(
    () => ({
      openBlock,
      openBlockById,
      openEvent,
      openAssignment,
      openItem,
      createBlock,
      moveBlock,
      setBlockStatus,
      deleteBlock,
      setIssueStatus,
      addStudyTime,
      dialog,
    }),
    [openBlock, openBlockById, openEvent, openAssignment, openItem, createBlock, moveBlock, setBlockStatus, deleteBlock, setIssueStatus, addStudyTime, dialog],
  );
}
