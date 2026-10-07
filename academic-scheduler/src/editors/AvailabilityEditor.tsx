// Placeholder: replaced by the real study-time window editor.
import type { AvailabilityWindow } from '../model/types';
import type { EditorProps } from './EditorHost';
import { Modal } from '../ui/Modal';

export function AvailabilityEditor({ id, onClose }: EditorProps<AvailabilityWindow>) {
  return (
    <Modal title={id ? 'Edit study-time window' : 'New study-time window'} onClose={onClose}>
      <p>Not implemented yet.</p>
    </Modal>
  );
}
