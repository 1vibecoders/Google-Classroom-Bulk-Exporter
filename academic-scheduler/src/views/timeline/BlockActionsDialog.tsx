// Quick actions of a scheduled block: mark done / skip, pin, move or resize
// with buttons (the keyboard alternative to dragging), edit, delete. Shows
// why a block is flagged (overlap, after its deadline) in words.
import { useEffect, useState } from 'react';
import type { BlockView } from '../../lib/calendar';
import { assignmentProgress } from '../../lib/workload';
import { ASSIGNMENT_TYPE_LABELS, BLOCK_STATUS_LABELS } from '../../model/constants';
import type { BlockStatus, DateStr, ScheduleBlock, ScheduleDocument } from '../../model/types';
import { formatDateLong, formatDateOrDateTime, formatDuration, isValidDate, isValidLocalDateTime, isValidTime, minutesToTime, timeToMinutes } from '../../lib/time';
import { Modal } from '../../ui/Modal';
import { Icon } from '../../ui/Icon';
import { DateField, TimeField } from '../../ui/fields';
import { useNow } from '../../ui/hooks';
import { getDayModels } from './modelCache';
import { NUDGE_MINUTES, blockStatus, changeBlock, conflictText, formatSpan, isUnmarkedPast, originText, type BlockChange, type Span } from './logic';

interface Props {
  doc: ScheduleDocument;
  blockId: string;
  onClose: () => void;
  onMove: (view: BlockView, date: DateStr, span: Span) => void;
  onStatus: (block: ScheduleBlock, status: BlockStatus, label: string) => void;
  onLocked: (block: ScheduleBlock, locked: boolean) => void;
  onEdit: (block: ScheduleBlock) => void;
  onOpenAssignment: (id: string) => void;
  onDelete: (block: ScheduleBlock, label: string) => Promise<boolean>;
}

export function BlockActionsDialog({ doc, blockId, onClose, onMove, onStatus, onLocked, onEdit, onOpenAssignment, onDelete }: Props) {
  const now = useNow();
  const [message, setMessage] = useState('');
  const block = doc.scheduleBlocks.find((b) => b.id === blockId);
  const date = block && isValidLocalDateTime(block.start) ? block.start.slice(0, 10) : null;
  const view = date ? getDayModels(doc, date, 1)[0]?.blocks.find((v) => v.block.id === blockId) : undefined;

  // The block was deleted (here, in another tab, or by an undo): close.
  useEffect(() => {
    if (!block) onClose();
  }, [block, onClose]);
  if (!block) return null;

  const label = view?.label ?? block.title ?? 'Work block';
  const status = view ? blockStatus(view) : block.status ?? 'planned';
  const generatedLike = (block.origin ?? 'generated') !== 'user';

  const apply = (change: BlockChange, what: string) => {
    if (!view) return;
    const next = changeBlock(block, change);
    if (!next) {
      setMessage(`Cannot ${what}: the block already starts or ends at the edge of the day.`);
      return;
    }
    onMove(view, next.date, next.span);
    setMessage(`Moved to ${formatDateLong(next.date)}, ${formatSpan(next.span.start, next.span.end)}.`);
  };

  const assignment = view?.assignment;
  const progress = assignment ? assignmentProgress(doc, assignment, now) : null;
  const unmarked = view && date ? isUnmarkedPast(date, view, now) : false;

  return (
    <Modal
      title={label}
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <div className="left">
            <button type="button" className="btn danger" onClick={() => void onDelete(block, label)}>
              <Icon name="trash" />
              Delete
            </button>
          </div>
          <button type="button" className="btn" onClick={() => onEdit(block)}>
            <Icon name="edit" />
            Edit details
          </button>
          <button type="button" className="btn primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="ba stack">
        <div className="ba-summary">
          {view && date ? (
            <p className="ba-when">
              <Icon name="clock" size={14} /> {formatDateLong(date)} · {formatSpan(view.start, view.end)} · {formatDuration(view.minutes)}
            </p>
          ) : (
            <p className="ba-when muted">The time of this block cannot be read. Use “Edit details” to fix it.</p>
          )}
          {view?.taskTitle && view.taskTitle !== view.workTitle ? <p className="ba-line">Step: {view.taskTitle}</p> : null}
          <div className="row">
            <span className={`badge ${status === 'done' ? 'success' : ''}`}>{BLOCK_STATUS_LABELS[status]}</span>
            {view?.isBreak ? <span className="badge">Break</span> : null}
            <span className="badge">{originText(block)}</span>
            {block.locked ? (
              <span className="badge accent">
                <Icon name="lock" size={11} /> Pinned
              </span>
            ) : null}
          </div>
          {unmarked ? <p className="ba-line ba-question">This session is over. Did you do it?</p> : null}
          {block.description ? (
            <div className="ba-text">
              <span className="field-label">What to do</span>
              <p>{block.description}</p>
            </div>
          ) : null}
          {block.notes ? (
            <div className="ba-text">
              <span className="field-label">Your notes</span>
              <p>{block.notes}</p>
            </div>
          ) : null}
          {view?.conflict ? (
            <p className="banner warning ba-flag">
              <Icon name="warning" /> <span>Conflict: {conflictText(view)}.</span>
            </p>
          ) : null}
          {view?.late && view.lateReason ? (
            <p className="banner error ba-flag">
              <Icon name="warning" /> <span>Late: {view.lateReason}.</span>
            </p>
          ) : null}
          {assignment ? (
            <div className="ba-assignment">
              <div className="ba-assignment-text">
                <strong>{assignment.title}</strong>
                <span className="muted small">
                  {[
                    assignment.due ? `Due ${formatDateOrDateTime(assignment.due)}` : null,
                    assignment.assessmentDate
                      ? `${assignment.type && ASSIGNMENT_TYPE_LABELS[assignment.type] ? ASSIGNMENT_TYPE_LABELS[assignment.type] : 'Assessment'} ${formatDateOrDateTime(assignment.assessmentDate)}`
                      : null,
                    progress && progress.remainingMinutes !== null ? `${formatDuration(progress.remainingMinutes)} left` : 'No estimate',
                    progress ? `${formatDuration(progress.scheduledMinutes)} still scheduled` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <button type="button" className="btn small" onClick={() => onOpenAssignment(assignment.id)}>
                Open assignment
              </button>
            </div>
          ) : null}
        </div>

        <div className="row ba-status" role="group" aria-label="Session status">
          {status !== 'done' ? (
            <button type="button" className="btn primary" onClick={() => onStatus(block, 'done', label)}>
              <Icon name="check" />
              Mark done
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => onStatus(block, 'planned', label)}>
              <Icon name="undo" />
              Mark not done
            </button>
          )}
          {status !== 'skipped' ? (
            <button type="button" className="btn" onClick={() => onStatus(block, 'skipped', label)}>
              <Icon name="x" />
              Skip
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => onStatus(block, 'planned', label)}>
              <Icon name="undo" />
              Plan again
            </button>
          )}
          <button type="button" className="btn ghost" aria-pressed={!!block.locked} onClick={() => onLocked(block, !block.locked)}>
            <Icon name={block.locked ? 'unlock' : 'lock'} />
            {block.locked ? 'Unpin' : 'Pin'}
          </button>
        </div>

        {view && date ? (
          <fieldset className="ba-move">
            <legend>Move or resize</legend>
            <div className="ba-move-grid">
              <button type="button" className="btn small" onClick={() => apply({ minutes: -NUDGE_MINUTES }, 'move earlier')}>
                15 min earlier
              </button>
              <button type="button" className="btn small" onClick={() => apply({ minutes: NUDGE_MINUTES }, 'move later')}>
                15 min later
              </button>
              <button type="button" className="btn small" onClick={() => apply({ days: -1 }, 'move')}>
                <Icon name="chevronLeft" size={14} />
                Previous day
              </button>
              <button type="button" className="btn small" onClick={() => apply({ days: 1 }, 'move')}>
                Next day
                <Icon name="chevronRight" size={14} />
              </button>
              <button type="button" className="btn small" onClick={() => apply({ resize: -NUDGE_MINUTES }, 'shorten it')}>
                15 min shorter
              </button>
              <button type="button" className="btn small" onClick={() => apply({ resize: NUDGE_MINUTES }, 'lengthen it')}>
                15 min longer
              </button>
            </div>
            <div className="form-grid">
              <DateField
                label="Date"
                value={date}
                onChange={(value) => {
                  if (isValidDate(value) && value !== date) apply({ date: value }, 'move');
                }}
              />
              <TimeField
                label="Start time"
                value={minutesToTime(view.start)}
                onChange={(value) => {
                  if (isValidTime(value)) apply({ startAt: timeToMinutes(value) }, 'move');
                }}
              />
            </div>
            {generatedLike && !block.locked ? (
              <p className="hint small muted">Moving a block planned by /academic-schedule or the planner pins it, so later imports keep your time.</p>
            ) : null}
            <p className="small muted ba-message" role="status">
              {message}
            </p>
          </fieldset>
        ) : null}
      </div>
    </Modal>
  );
}
