// Shown when an editor is opened for an item that no longer exists (deleted
// here, in another tab, or by an undo).
import { Modal } from '../../ui/Modal';
import '../../styles/editors.css';

export function MissingItem({ itemLabel, onClose }: { itemLabel: string; onClose: () => void }) {
  return (
    <Modal
      title={`This ${itemLabel} no longer exists`}
      size="narrow"
      onClose={onClose}
      footer={
        <button type="button" className="btn primary" onClick={onClose} autoFocus>
          Close
        </button>
      }
    >
      <p>It may have been deleted here or in another tab, or removed by an undo.</p>
    </Modal>
  );
}
