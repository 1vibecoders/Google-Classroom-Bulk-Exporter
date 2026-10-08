// Placeholder: replaced by the real class editor.
import type { SchoolClass } from '../model/types';
import type { EditorProps } from './EditorHost';
import { Modal } from '../ui/Modal';

export function ClassEditor({ id, onClose }: EditorProps<SchoolClass>) {
  return (
    <Modal title={id ? 'Edit class' : 'New class'} onClose={onClose}>
      <p>Not implemented yet.</p>
    </Modal>
  );
}
