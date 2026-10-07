// Placeholder: replaced by the real assignment editor.
import type { Assignment } from '../model/types';
import type { EditorProps } from './EditorHost';
import { Modal } from '../ui/Modal';

export function AssignmentEditor({ id, onClose }: EditorProps<Assignment>) {
  return (
    <Modal title={id ? 'Edit assignment' : 'New assignment'} onClose={onClose}>
      <p>Not implemented yet.</p>
    </Modal>
  );
}
