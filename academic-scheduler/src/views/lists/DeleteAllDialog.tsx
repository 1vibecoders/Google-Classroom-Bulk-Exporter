// "Delete all data" with a typed confirmation. By default the deleted
// schedule stays restorable from the undo history in this browser; the person
// can choose to clear that history too.
import { useState } from 'react';
import { useStore } from '../../state/store';
import { emptyDocument } from '../../state/reducer';
import { nowLocal } from '../../lib/time';
import { Modal } from '../../ui/Modal';
import { Icon } from '../../ui/Icon';
import { Checkbox } from '../../ui/fields';
import { snapshotId } from './format';

export const DELETE_WORD = 'DELETE';

export function DeleteAllDialog({ onClose, onExport, summary }: { onClose: () => void; onExport: () => void; summary: string }) {
  const { dispatch, notify } = useStore();
  const [typed, setTyped] = useState('');
  const [clearHistory, setClearHistory] = useState(false);
  const ready = typed.trim().toUpperCase() === DELETE_WORD;

  const run = () => {
    if (!ready) return;
    if (clearHistory) {
      dispatch({ type: 'loadState', state: { doc: emptyDocument(), snapshots: [] } });
      notify('All data was deleted from this browser.', { tone: 'success' });
    } else {
      const id = snapshotId();
      dispatch({ type: 'replaceDocument', doc: emptyDocument(), label: 'Before deleting all data', now: nowLocal(), snapshotId: id });
      notify('All data was deleted. You can still restore it from the undo history.', {
        tone: 'success',
        action: { label: 'Undo', run: () => dispatch({ type: 'undo', snapshotId: id }) },
      });
    }
    onClose();
  };

  return (
    <Modal
      title="Delete all data?"
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn danger" onClick={run} disabled={!ready}>
            <Icon name="trash" /> Delete everything
          </button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <p style={{ margin: 0 }}>This removes your whole schedule from this browser: {summary}, and your settings.</p>
        <div className="row">
          <button type="button" className="btn small" onClick={onExport}>
            <Icon name="download" size={14} /> Export a backup first
          </button>
        </div>
        <div className="field">
          <label htmlFor="delete-all-confirm">
            Type <strong>{DELETE_WORD}</strong> to confirm
          </label>
          <input
            id="delete-all-confirm"
            className="input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
        </div>
        <Checkbox
          checked={clearHistory}
          onChange={setClearHistory}
          label="Also clear the undo history"
          hint="Otherwise the deleted schedule can still be restored from “Undo history” on this page."
        />
      </form>
    </Modal>
  );
}
