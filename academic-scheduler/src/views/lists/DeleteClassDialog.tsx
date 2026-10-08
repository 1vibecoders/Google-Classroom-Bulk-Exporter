// Deleting a class asks what happens to its assignments and events: keep
// them (without a class) or delete them too (with their sessions).
import { useState } from 'react';
import type { SchoolClass } from '../../model/types';
import { useStore } from '../../state/store';
import { nowLocal } from '../../lib/time';
import { Modal } from '../../ui/Modal';
import { Icon } from '../../ui/Icon';
import type { ClassStats } from './classModel';
import { plural } from './format';

export function DeleteClassDialog({ schoolClass, stats, onClose }: { schoolClass: SchoolClass; stats: ClassStats; onClose: () => void }) {
  const { dispatch, notify } = useStore();
  const [mode, setMode] = useState<'keep' | 'delete'>('keep');
  const hasContents = stats.assignments > 0 || stats.events > 0;
  const contents = [stats.assignments ? plural(stats.assignments, 'assignment') : '', stats.events ? plural(stats.events, 'event') : '']
    .filter(Boolean)
    .join(' and ');

  const one = stats.assignments + stats.events === 1;
  const run = () => {
    const deleteContents = hasContents && mode === 'delete';
    dispatch({ type: 'deleteClass', id: schoolClass.id, deleteContents, now: nowLocal() });
    notify(
      deleteContents
        ? `Deleted ${schoolClass.name} with its ${contents}.`
        : `Deleted ${schoolClass.name}.${hasContents ? ` Its ${contents} ${one ? 'was' : 'were'} kept without a class.` : ''}`,
      {
        tone: 'success',
      },
    );
    onClose();
  };

  return (
    <Modal
      title={`Delete ${schoolClass.name}?`}
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn danger" onClick={run}>
            <Icon name="trash" />
            {hasContents && mode === 'delete' ? `Delete class and ${contents}` : 'Delete class'}
          </button>
        </>
      }
    >
      <div className="stack">
        {hasContents ? (
          <fieldset className="ls-choice">
            <legend>
              {schoolClass.name} has {contents}. What should happen to {one ? 'it' : 'them'}?
            </legend>
            <label className="ls-choice-option">
              <input type="radio" name="delete-class-mode" value="keep" checked={mode === 'keep'} onChange={() => setMode('keep')} />
              <span>
                <strong>{one ? 'Keep it' : 'Keep them'}</strong>
                <span className="small muted">{one ? 'It stays' : 'They stay'} in your schedule without a class.</span>
              </span>
            </label>
            <label className="ls-choice-option">
              <input type="radio" name="delete-class-mode" value="delete" checked={mode === 'delete'} onChange={() => setMode('delete')} />
              <span>
                <strong>{one ? 'Delete it too' : 'Delete them too'}</strong>
                <span className="small muted">
                  {stats.blocks
                    ? `Including ${plural(stats.blocks, 'scheduled session')} of those assignments.`
                    : 'Everything that belongs to this class is removed.'}
                </span>
              </span>
            </label>
          </fieldset>
        ) : (
          <p style={{ margin: 0 }}>The class has no assignments or events.</p>
        )}
        {mode === 'delete' && stats.doneBlocks > 0 ? (
          <div className="banner warning" role="status">
            <Icon name="warning" />
            <span>{plural(stats.doneBlocks, 'session')} you marked done will be deleted too, and with them the record of that work.</span>
          </div>
        ) : null}
        {(schoolClass.origin ?? 'generated') === 'generated' ? (
          <p className="small muted" style={{ margin: 0 }}>
            This class was imported from /academic-schedule. The website remembers what you delete, so a later import does not add it again.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
